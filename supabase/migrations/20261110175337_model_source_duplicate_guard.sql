-- Source-level protection for model Reels. Installing this migration does not
-- publish, enable generation, change existing schedules, or seed provenance.
-- Audited provenance and historical claims are installed separately by postgres.
create schema content_dedupe;
revoke all on schema content_dedupe from public, anon, authenticated, service_role;
grant usage on schema content_dedupe to service_role;

-- An Instagram account cannot gain a fresh duplicate ledger by being connected
-- under another app owner. Transfers require explicit offline reconciliation.
create table content_dedupe.account_owners (
 target_ig_user_id text primary key check(target_ig_user_id ~ '^[0-9]{5,30}$'),
 owner uuid not null references auth.users(id),
 created_at timestamptz not null default clock_timestamp()
);
create table content_dedupe.sources (
 id uuid primary key default gen_random_uuid(),
 owner uuid not null references auth.users(id),
 canonical_key text not null check(length(canonical_key) between 1 and 256),
 evidence jsonb not null check(jsonb_typeof(evidence)='object' and evidence<>'{}'::jsonb),
 created_at timestamptz not null default clock_timestamp(),
 unique(owner,canonical_key), unique(owner,id)
);
create table content_dedupe.source_aliases (
 owner uuid not null,
 kind text not null check(kind in ('instagram_shortcode','x_status_id','sha256')),
 value text not null,
 source_id uuid not null,
 created_at timestamptz not null default clock_timestamp(),
 primary key(owner,kind,value),
 foreign key(owner,source_id) references content_dedupe.sources(owner,id)
);
create index source_aliases_source on content_dedupe.source_aliases(owner,source_id);
create table content_dedupe.review_sources (
 review_id uuid primary key,
 owner uuid not null,
 model text not null check(model in ('kiikii','tuuva')),
 source_id uuid not null,
 output_sha256 text not null check(output_sha256 ~ '^[a-f0-9]{64}$'),
 evidence jsonb not null,
 created_at timestamptz not null default clock_timestamp(),
 foreign key(review_id,owner,model) references public.content_review_items(id,user_id,model),
 foreign key(owner,source_id) references content_dedupe.sources(owner,id)
);
create index review_sources_source on content_dedupe.review_sources(owner,source_id);
-- Post IDs intentionally survive a deleted post as durable history. Runtime
-- deletion only removes a reservation that never reached any external action.
create table content_dedupe.post_sources (
 post_id uuid primary key,
 owner uuid not null,
 model text not null check(model in ('kiikii','tuuva')),
 review_id uuid not null references content_dedupe.review_sources(review_id),
 source_id uuid not null,
 target_ig_user_id text not null,
 output_sha256 text not null check(output_sha256 ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null default clock_timestamp(),
 foreign key(owner,source_id) references content_dedupe.sources(owner,id)
);
create table content_dedupe.claims (
 owner uuid not null,
 target_ig_user_id text not null,
 source_id uuid not null,
 post_id uuid not null,
 state text not null check(state in ('reserved','consumed','historical','uncertain')),
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 primary key(owner,target_ig_user_id,source_id),
 foreign key(owner,source_id) references content_dedupe.sources(owner,id)
);
create index claims_post on content_dedupe.claims(post_id);
create table content_dedupe.output_claims (
 owner uuid not null,
 target_ig_user_id text not null,
 output_sha256 text not null check(output_sha256 ~ '^[a-f0-9]{64}$'),
 post_id uuid not null,
 state text not null check(state in ('reserved','consumed','historical','uncertain')),
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 primary key(owner,target_ig_user_id,output_sha256)
);
create index output_claims_post on content_dedupe.output_claims(post_id);

alter table content_dedupe.account_owners enable row level security;
alter table content_dedupe.sources enable row level security;
alter table content_dedupe.source_aliases enable row level security;
alter table content_dedupe.review_sources enable row level security;
alter table content_dedupe.post_sources enable row level security;
alter table content_dedupe.claims enable row level security;
alter table content_dedupe.output_claims enable row level security;
revoke all on all tables in schema content_dedupe from public,anon,authenticated,service_role;

create function content_dedupe.assert_owner(p_owner uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 if p_owner is null or not exists(select 1 from public.user_roles where user_id=p_owner and role='owner') then
  raise exception 'SOURCE_REVIEW_REQUIRED: owner required';
 end if;
end $$;

create function content_dedupe.add_alias(p_owner uuid,p_source_id uuid,p_kind text,p_value text)
returns void language plpgsql security definer set search_path='' as $$
declare actual uuid; normalized text:=btrim(p_value);
begin
 if p_kind='sha256' then normalized:=lower(normalized); end if;
 if normalized is null or not (
  (p_kind='instagram_shortcode' and normalized ~ '^[A-Za-z0-9_-]{5,64}$') or
  (p_kind='x_status_id' and normalized ~ '^[0-9]{5,25}$') or
  (p_kind='sha256' and normalized ~ '^[a-f0-9]{64}$')) then
  raise exception 'SOURCE_REVIEW_REQUIRED: invalid source alias';
 end if;
 if not exists(select 1 from content_dedupe.sources where owner=p_owner and id=p_source_id) then
  raise exception 'SOURCE_REVIEW_REQUIRED: source owner mismatch';
 end if;
 insert into content_dedupe.source_aliases(owner,kind,value,source_id)
 values(p_owner,p_kind,normalized,p_source_id) on conflict do nothing;
 -- A unique index, rather than a pre-insert NOT EXISTS, arbitrates concurrent
 -- registrations. Never silently reassign an alias to another source family.
 select source_id into actual from content_dedupe.source_aliases
 where owner=p_owner and kind=p_kind and value=normalized;
 if actual is distinct from p_source_id then
  raise exception 'SOURCE_REVIEW_REQUIRED: alias belongs to a different verified source';
 end if;
end $$;

create function content_dedupe.register_verified_source(p_owner uuid,p_canonical_key text,p_aliases jsonb,p_evidence jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare source uuid; a jsonb; k text:=btrim(p_canonical_key);
begin
 perform content_dedupe.assert_owner(p_owner);
 if k is null or length(k) not between 1 and 256 or k ~ '[[:cntrl:]]' or
  jsonb_typeof(p_evidence) is distinct from 'object' or p_evidence='{}'::jsonb or pg_column_size(p_evidence)>16384 or
  jsonb_typeof(p_aliases) is distinct from 'array' then
  raise exception 'SOURCE_REVIEW_REQUIRED: verified source and evidence required';
 end if;
 if jsonb_array_length(p_aliases) not between 1 and 200 then
  raise exception 'SOURCE_REVIEW_REQUIRED: source aliases required';
 end if;
 insert into content_dedupe.sources(owner,canonical_key,evidence) values(p_owner,k,p_evidence)
 on conflict(owner,canonical_key) do nothing;
 select id into source from content_dedupe.sources where owner=p_owner and canonical_key=k for update;
 for a in select value from jsonb_array_elements(p_aliases) loop
  if jsonb_typeof(a) is distinct from 'object' or jsonb_typeof(a->'kind') is distinct from 'string'
   or jsonb_typeof(a->'value') is distinct from 'string' then
   raise exception 'SOURCE_REVIEW_REQUIRED: invalid alias entry';
  end if;
  perform content_dedupe.add_alias(p_owner,source,a->>'kind',a->>'value');
 end loop;
 return source;
end $$;

create function public.register_verified_source(p_owner uuid,p_canonical_key text,p_aliases jsonb,p_evidence jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
begin
 if current_user not in ('postgres','service_role') then raise exception 'SOURCE_REVIEW_REQUIRED: server only'; end if;
 return content_dedupe.register_verified_source(p_owner,p_canonical_key,p_aliases,p_evidence);
end $$;

create function content_dedupe.bind_review_source(p_owner uuid,p_review_id uuid,p_source_id uuid,p_expected_output_sha text,p_evidence jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare r public.content_review_items; b content_dedupe.review_sources; expected text:=lower(p_expected_output_sha);
begin
 perform content_dedupe.assert_owner(p_owner);
 if jsonb_typeof(p_evidence) is distinct from 'object' or p_evidence='{}'::jsonb or pg_column_size(p_evidence)>16384 then
  raise exception 'SOURCE_REVIEW_REQUIRED: provenance evidence required';
 end if;
 select * into r from public.content_review_items where id=p_review_id and user_id=p_owner for update;
 if not found or r.model not in ('kiikii','tuuva') or r.status='uploading' or r.sha256 is null or
  expected is null or expected !~ '^[a-f0-9]{64}$' or r.sha256<>expected then
  raise exception 'SOURCE_REVIEW_REQUIRED: review output changed or is incomplete';
 end if;
 select * into b from content_dedupe.review_sources where review_id=r.id;
 if found then
  if b.owner<>p_owner or b.model<>r.model or b.source_id<>p_source_id or b.output_sha256<>expected then
   raise exception 'SOURCE_REVIEW_REQUIRED: review provenance is immutable';
  end if;
  return b.source_id;
 end if;
 perform content_dedupe.add_alias(p_owner,p_source_id,'sha256',expected);
 insert into content_dedupe.review_sources(review_id,owner,model,source_id,output_sha256,evidence)
 values(r.id,p_owner,r.model,p_source_id,expected,p_evidence);
 return p_source_id;
end $$;

create function public.bind_review_source(p_owner uuid,p_review_id uuid,p_source_id uuid,p_expected_output_sha text,p_evidence jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
begin
 if current_user not in ('postgres','service_role') then raise exception 'SOURCE_REVIEW_REQUIRED: server only'; end if;
 return content_dedupe.bind_review_source(p_owner,p_review_id,p_source_id,p_expected_output_sha,p_evidence);
end $$;

create function content_dedupe.resolve_review(p_owner uuid,p_review_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare r public.content_review_items; b content_dedupe.review_sources; j public.model_pipeline_jobs;
 i public.reel_inbox_items; evidence jsonb:='[]'; a jsonb; candidate uuid; resolved uuid; input_sha text;
begin
 select * into r from public.content_review_items where id=p_review_id and user_id=p_owner;
 if not found or r.status='uploading' or r.sha256 is null then
  raise exception 'SOURCE_REVIEW_REQUIRED: finalized review required';
 end if;
 select * into b from content_dedupe.review_sources where review_id=r.id;
 if found then
  if b.owner<>p_owner or b.model<>r.model or b.output_sha256<>r.sha256 then
   raise exception 'SOURCE_REVIEW_REQUIRED: review no longer matches verified provenance';
  end if;
  return b.source_id;
 end if;
 begin
  select * into strict j from public.model_pipeline_jobs where user_id=p_owner and model=r.model and review_id=r.id;
 exception when no_data_found or too_many_rows then
  raise exception 'SOURCE_REVIEW_REQUIRED: generation provenance is missing or ambiguous';
 end;
 if j.state<>'review' or j.provider_id is null then
  raise exception 'SOURCE_REVIEW_REQUIRED: no verified source binding or reviewed generation job';
 end if;
 if j.inbox_id is not null then
  select * into i from public.reel_inbox_items where id=j.inbox_id and user_id=p_owner;
  if not found or i.shortcode is null then raise exception 'SOURCE_REVIEW_REQUIRED: source inbox missing'; end if;
  input_sha:=lower(i.receipt->>'sha256');
  if input_sha is null or input_sha !~ '^[a-f0-9]{64}$' then
   raise exception 'SOURCE_REVIEW_REQUIRED: verified original file hash missing';
  end if;
  evidence:=evidence||jsonb_build_array(jsonb_build_object('kind','instagram_shortcode','value',i.shortcode),jsonb_build_object('kind','sha256','value',input_sha));
 end if;
 if j.source_sha256 is not null then
  evidence:=evidence||jsonb_build_array(jsonb_build_object('kind','sha256','value',lower(j.source_sha256)));
 end if;
 if jsonb_array_length(evidence)=0 then raise exception 'SOURCE_REVIEW_REQUIRED: generation source missing'; end if;
 for a in select value from jsonb_array_elements(evidence) loop
  select source_id into candidate from content_dedupe.source_aliases
  where owner=p_owner and kind=a->>'kind' and value=a->>'value';
  if candidate is null or (resolved is not null and resolved<>candidate) then
   raise exception 'SOURCE_REVIEW_REQUIRED: source evidence is unknown or contradictory';
  end if;
  resolved:=candidate;
 end loop;
 return content_dedupe.bind_review_source(p_owner,r.id,resolved,r.sha256,
  jsonb_build_object('kind','reviewed_generation_job','job_id',j.id,'source_aliases',evidence));
end $$;

create function content_dedupe.reserve_post(p_post_id uuid,p_mode text default 'reserve')
returns uuid language plpgsql security definer set search_path='' as $$
declare p public.content_posts; r public.content_review_items; b content_dedupe.post_sources;
 source uuid; c content_dedupe.claims; h content_dedupe.output_claims; wanted text;
 has_receipt boolean; uncertain boolean; account_owner uuid;
begin
 if p_mode not in ('reserve','consume','seed') then raise exception 'SOURCE_REVIEW_REQUIRED: invalid guard operation'; end if;
 select * into p from public.content_posts where id=p_post_id for update;
 if not found or p.destination not in ('kiikii','tuuva') then
  raise exception 'SOURCE_REVIEW_REQUIRED: model post required';
 end if;
 perform content_dedupe.assert_owner(p.user_id);
 if p.target_ig_user_id is null or p.target_ig_user_id !~ '^[0-9]{5,30}$' or p.media_sha256 is null then
  raise exception 'SOURCE_REVIEW_REQUIRED: exact Instagram target and output hash required';
 end if;
 insert into content_dedupe.account_owners(target_ig_user_id,owner) values(p.target_ig_user_id,p.user_id)
 on conflict do nothing;
 select owner into account_owner from content_dedupe.account_owners where target_ig_user_id=p.target_ig_user_id for update;
 if account_owner is distinct from p.user_id then
  raise exception 'SOURCE_REVIEW_REQUIRED: Instagram account ownership changed; reconcile its existing publication history';
 end if;
 select * into r from public.content_review_items where publish_post_id=p.id and user_id=p.user_id and model=p.destination;
 if not found or r.sha256 is distinct from p.media_sha256 then
  raise exception 'SOURCE_REVIEW_REQUIRED: post does not match a reviewed output';
 end if;
 source:=content_dedupe.resolve_review(p.user_id,r.id);
 select * into b from content_dedupe.post_sources where post_id=p.id;
 if found and (b.owner<>p.user_id or b.model<>p.destination or b.review_id<>r.id or b.source_id<>source or
  b.target_ig_user_id<>p.target_ig_user_id or b.output_sha256<>p.media_sha256) then
  raise exception 'SOURCE_REVIEW_REQUIRED: prepared post provenance changed';
 end if;
 select exists(select 1 from public.content_publications where content_post_id=p.id and channel='reel' and
  (platform_media_id is not null or status='published')) into has_receipt;
 select exists(select 1 from public.content_publications where content_post_id=p.id and channel='reel' and
  (external_action_started_at is not null or recovery_required)) into uncertain;
 if exists(select 1 from public.content_publications where content_post_id=p.id and channel='reel' and
  published_ig_user_id is not null and published_ig_user_id<>p.target_ig_user_id) then
  raise exception 'SOURCE_REVIEW_REQUIRED: published account differs from approved target';
 end if;
 if p_mode='seed' then
  if p.status='published' or has_receipt then wanted:='historical';
  elsif uncertain then wanted:='uncertain';
  elsif p.status in ('scheduled','publishing') then wanted:='reserved';
  else raise exception 'SOURCE_REVIEW_REQUIRED: historical seed requires scheduled or externally attempted post'; end if;
 else wanted:=case when p_mode='consume' then 'consumed' else 'reserved' end;
 end if;
 insert into content_dedupe.claims(owner,target_ig_user_id,source_id,post_id,state)
 values(p.user_id,p.target_ig_user_id,source,p.id,wanted) on conflict do nothing;
 select * into c from content_dedupe.claims where owner=p.user_id and target_ig_user_id=p.target_ig_user_id and source_id=source for update;
 if not found then raise exception 'SOURCE_REVIEW_REQUIRED: source reservation is missing'; end if;
 if c.post_id is distinct from p.id and not (p_mode='seed' and wanted in ('historical','uncertain') and c.state in ('historical','uncertain','consumed')) then
  raise exception 'DUPLICATE_SOURCE: source already reserved or used on this Instagram account (post %)',c.post_id;
 end if;
 insert into content_dedupe.output_claims(owner,target_ig_user_id,output_sha256,post_id,state)
 values(p.user_id,p.target_ig_user_id,p.media_sha256,p.id,wanted) on conflict do nothing;
 select * into h from content_dedupe.output_claims where owner=p.user_id and target_ig_user_id=p.target_ig_user_id and output_sha256=p.media_sha256 for update;
 if not found then raise exception 'SOURCE_REVIEW_REQUIRED: output reservation is missing'; end if;
 if h.post_id is distinct from p.id and not (p_mode='seed' and wanted in ('historical','uncertain') and h.state in ('historical','uncertain','consumed')) then
  raise exception 'DUPLICATE_SOURCE: exact output already reserved or used on this Instagram account (post %)',h.post_id;
 end if;
 -- Claims never become reusable because of a failed HTTP response or a status edit.
 if wanted<>'reserved' then
  update content_dedupe.claims set state=wanted,updated_at=clock_timestamp()
   where owner=p.user_id and target_ig_user_id=p.target_ig_user_id and source_id=source and post_id=p.id;
  update content_dedupe.output_claims set state=wanted,updated_at=clock_timestamp()
   where owner=p.user_id and target_ig_user_id=p.target_ig_user_id and output_sha256=p.media_sha256 and post_id=p.id;
 end if;
 insert into content_dedupe.post_sources(post_id,owner,model,review_id,source_id,target_ig_user_id,output_sha256)
 values(p.id,p.user_id,p.destination,r.id,source,p.target_ig_user_id,p.media_sha256) on conflict do nothing;
 return source;
end $$;

create function public.seed_existing_post(p_post_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare source uuid;
begin
 if current_user<>'postgres' then raise exception 'SOURCE_REVIEW_REQUIRED: historical seed is postgres only'; end if;
 source:=content_dedupe.reserve_post(p_post_id,'seed');
 return jsonb_build_object('post_id',p_post_id,'source_id',source);
end $$;

create function content_dedupe.guard_post()
returns trigger language plpgsql security definer set search_path='' as $$
declare b content_dedupe.post_sources;
begin
 if TG_OP='DELETE' then
  if old.destination not in ('kiikii','tuuva') then return old; end if;
  if old.status in ('publishing','published') or old.published_at is not null or
   exists(select 1 from public.content_publications where content_post_id=old.id and
    (platform_container_id is not null or platform_media_id is not null or external_action_started_at is not null or recovery_required or status='published')) or
   exists(select 1 from content_dedupe.claims where post_id=old.id and state<>'reserved') or
   exists(select 1 from content_dedupe.output_claims where post_id=old.id and state<>'reserved') then
   raise exception 'DUPLICATE_SOURCE: attempted or published source history cannot be deleted';
  end if;
  delete from content_dedupe.claims where post_id=old.id and state='reserved';
  delete from content_dedupe.output_claims where post_id=old.id and state='reserved';
  delete from content_dedupe.post_sources where post_id=old.id;
  return old;
 end if;
 if TG_OP='UPDATE' then
  select * into b from content_dedupe.post_sources where post_id=old.id;
  if found and (new.user_id is distinct from b.owner or new.destination is distinct from b.model or
   new.target_ig_user_id is distinct from b.target_ig_user_id or new.media_sha256 is distinct from b.output_sha256) then
   raise exception 'SOURCE_REVIEW_REQUIRED: claimed post identity is immutable';
  end if;
 end if;
 if new.destination not in ('kiikii','tuuva') then return new; end if;
 if new.status in ('scheduled','publishing') and
  (TG_OP='INSERT' or old.status is distinct from new.status) and
  (new.published_at is not null or (TG_OP='UPDATE' and old.status='published') or
   exists(select 1 from public.content_publications where content_post_id=new.id and channel='reel' and
    (platform_media_id is not null or status='published' or external_action_started_at is not null or recovery_required)) or
   exists(select 1 from content_dedupe.claims where post_id=new.id and state<>'reserved') or
   exists(select 1 from content_dedupe.output_claims where post_id=new.id and state<>'reserved')) then
  raise exception 'DUPLICATE_SOURCE: an attempted or published post cannot be restarted';
 end if;
 -- BEFORE INSERT has no persisted row/review linkage yet. Model posts must be
 -- prepared first; a direct INSERT already scheduled cannot bypass provenance.
 if TG_OP='INSERT' and new.status in ('scheduled','publishing','published') then
  raise exception 'SOURCE_REVIEW_REQUIRED: prepare the reviewed model post before scheduling';
 end if;
 if new.status in ('scheduled','publishing') then perform content_dedupe.reserve_post(new.id,'reserve'); end if;
 if TG_OP='UPDATE' and new.status='published' and old.status is distinct from new.status then
  perform content_dedupe.reserve_post(new.id,'consume');
 end if;
 return new;
end $$;

create function content_dedupe.guard_primary_action()
returns trigger language plpgsql security definer set search_path='' as $$
declare p public.content_posts; first_action boolean; new_receipt boolean;
begin
 if TG_OP in ('UPDATE','DELETE') then
  select * into p from public.content_posts where id=old.content_post_id;
  if found and p.destination in ('kiikii','tuuva') and old.channel='reel' then
   if TG_OP='DELETE' then
    if old.platform_container_id is not null or old.platform_media_id is not null or old.external_action_started_at is not null or old.recovery_required or old.status='published' then
     raise exception 'DUPLICATE_SOURCE: attempted primary publication history cannot be deleted';
    end if;
    return old;
   end if;
   if new.content_post_id is distinct from old.content_post_id or new.channel is distinct from old.channel then
    raise exception 'SOURCE_REVIEW_REQUIRED: primary publication identity is immutable';
   end if;
  end if;
  if TG_OP='DELETE' then return old; end if;
 end if;
 select * into p from public.content_posts where id=new.content_post_id;
 if not found or p.destination not in ('kiikii','tuuva') or new.channel<>'reel' then return new; end if;
 if TG_OP='UPDATE' then
  if new.content_post_id is distinct from old.content_post_id or new.channel is distinct from old.channel then
   raise exception 'SOURCE_REVIEW_REQUIRED: primary publication identity is immutable';
  end if;
  if (old.external_action_started_at is not null and new.external_action_started_at is distinct from old.external_action_started_at) or
   (old.platform_media_id is not null and new.platform_media_id is distinct from old.platform_media_id) or
   (old.status='published' and new.status<>'published') then
   raise exception 'DUPLICATE_SOURCE: primary publication receipt or send intent cannot be reset';
  end if;
 end if;
 first_action:=new.external_action_started_at is not null and (TG_OP='INSERT' or old.external_action_started_at is null);
 new_receipt:=(new.platform_media_id is not null and (TG_OP='INSERT' or old.platform_media_id is null)) or
  (new.status='published' and (TG_OP='INSERT' or old.status<>'published'));
 if new.published_ig_user_id is not null and new.published_ig_user_id is distinct from p.target_ig_user_id then
  raise exception 'SOURCE_REVIEW_REQUIRED: publication target differs from approved account';
 end if;
 if first_action then
  if p.status<>'publishing' or (TG_OP='UPDATE' and (old.platform_media_id is not null or old.status='published')) then
   raise exception 'DUPLICATE_SOURCE: primary send requires a fresh publishing attempt';
  end if;
  if exists(select 1 from content_dedupe.claims where post_id=p.id and state<>'reserved') or
   exists(select 1 from content_dedupe.output_claims where post_id=p.id and state<>'reserved') then
   raise exception 'DUPLICATE_SOURCE: primary source send was already consumed';
  end if;
 end if;
 if first_action or new_receipt then perform content_dedupe.reserve_post(p.id,'consume'); end if;
 return new;
end $$;

create trigger model_source_post_guard before insert or update or delete on public.content_posts
 for each row execute function content_dedupe.guard_post();
create trigger model_source_primary_action_guard before insert or update or delete on public.content_publications
 for each row execute function content_dedupe.guard_primary_action();

revoke all on all functions in schema content_dedupe from public,anon,authenticated,service_role;
grant execute on function content_dedupe.register_verified_source(uuid,text,jsonb,jsonb) to service_role;
grant execute on function content_dedupe.bind_review_source(uuid,uuid,uuid,text,jsonb) to service_role;
revoke all on function public.register_verified_source(uuid,text,jsonb,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.bind_review_source(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.seed_existing_post(uuid) from public,anon,authenticated,service_role;
grant execute on function public.register_verified_source(uuid,text,jsonb,jsonb) to service_role;
grant execute on function public.bind_review_source(uuid,uuid,uuid,text,jsonb) to service_role;
comment on schema content_dedupe is 'Server-verified source provenance and permanent model Reel duplicate claims; no client write access.';
