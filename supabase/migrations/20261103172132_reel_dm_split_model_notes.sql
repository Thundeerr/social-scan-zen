-- Instagram can deliver a shared reel and its accompanying note as separate messages.
-- Keep only routing metadata and owned inbox IDs, never raw DM text or attachment URLs.
alter table public.reel_inbox_dm_receipts
  add column message_at timestamptz,
  add column explicit_model text check (explicit_model in ('kiikii','tuuva')),
  add column routing_locked boolean not null default false,
  add column routing_status text not null default 'legacy'
    check (routing_status in ('legacy','default','explicit','paired','unmatched','note_pending','note_applied','note_ambiguous','note_expired','manual')),
  add column paired_message_hash text check (paired_message_hash ~ '^[a-f0-9]{64}$');
create index reel_inbox_dm_receipts_message_time
  on public.reel_inbox_dm_receipts(user_id,sender,message_at) where message_at is not null;

-- A candidate may have several independent reasons to exist. Moving one receipt must
-- not erase an intentionally collected copy of the same reel for the other model.
create table public.reel_inbox_dm_claims (
  user_id uuid not null,
  claim_id text not null,
  inbox_id uuid not null,
  model text not null check (model in ('kiikii','tuuva')),
  message_hash text,
  created_at timestamptz not null default now(),
  primary key(user_id,claim_id,inbox_id),
  foreign key(user_id,inbox_id) references public.reel_inbox_items(user_id,id),
  foreign key(user_id,message_hash) references public.reel_inbox_dm_receipts(user_id,message_hash),
  check (message_hash is null or claim_id=message_hash)
);
create index reel_inbox_dm_claims_candidate on public.reel_inbox_dm_claims(user_id,inbox_id,model);
alter table public.reel_inbox_dm_claims enable row level security;
revoke all on public.reel_inbox_dm_claims from public,anon,authenticated;
grant all on public.reel_inbox_dm_claims to service_role;
insert into public.reel_inbox_dm_claims(user_id,claim_id,inbox_id,model,created_at)
select user_id,'legacy:'||gen_random_uuid()::text,inbox_id,model,created_at
from public.reel_inbox_dm_candidates;
comment on table public.reel_inbox_dm_claims is 'Private provenance for collected models. Legacy claims preserve existing intentional collections. No generation or publishing side effects.';

create function public.reel_inbox_dm_ingest_v4(
  p_receiver text,p_sender text,p_username text,p_hash text,
  p_links jsonb,p_diagnostics jsonb,p_model text,p_message_at timestamptz
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  actor uuid; result jsonb; legacy jsonb; entry jsonb;
  share public.reel_inbox_dm_receipts; note public.reel_inbox_dm_receipts;
  match_hash text; matched_model text; matches integer; reverse_matches integer;
  note_only boolean; final_status text; final_model text;
begin
  if current_user not in ('service_role','postgres') then raise exception 'service required'; end if;
  if p_model is not null and p_model not in ('kiikii','tuuva') then raise exception 'invalid model'; end if;
  if p_message_at is not null and not isfinite(p_message_at) then raise exception 'invalid message time'; end if;
  -- This is the same per-receiver lock used by v3, so concurrent note/share deliveries serialize.
  select user_id into actor from public.reel_inbox_dm_sources where receiver_id=p_receiver and enabled for update;
  if not found then return '{"ignored":true}'; end if;
  -- Capture untracked candidates BEFORE v3 inserts this event's candidate. This also
  -- preserves v3 writes in the migration-first/application-second deployment window.
  select coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb) into legacy
  from public.reel_inbox_dm_candidates c where c.user_id=actor and not exists (
    select 1 from public.reel_inbox_dm_claims cl where cl.user_id=c.user_id and cl.inbox_id=c.inbox_id and cl.model=c.model
  );
  result:=public.reel_inbox_dm_ingest_v3(p_receiver,p_sender,p_username,p_hash,p_links,p_diagnostics,coalesce(p_model,'kiikii'));
  if not (result ? 'results') then return result; end if;
  -- v3 rechecks ownership, pinned sender identity, diagnostics and replay protection.
  insert into public.reel_inbox_dm_claims(user_id,claim_id,inbox_id,model,created_at)
  select actor,'legacy:'||gen_random_uuid()::text,(x->>'inbox_id')::uuid,x->>'model',(x->>'created_at')::timestamptz
  from jsonb_array_elements(legacy) x on conflict do nothing;
  note_only:=jsonb_array_length(p_links)=0 and p_model is not null
    and (p_diagnostics->>'attachment_count')::integer=0
    and not (p_diagnostics->>'unsupported')::boolean;
  update public.reel_inbox_dm_receipts set
    message_at=p_message_at,explicit_model=p_model,
    routing_status=case when jsonb_array_length(p_links)>0 then case when p_model is null then 'default' else 'explicit' end
      when note_only then case when p_message_at is null then 'note_expired' else 'note_pending' end else 'unmatched' end
  where user_id=actor and message_hash=p_hash;
  for entry in select * from jsonb_array_elements(result->'results') loop
    insert into public.reel_inbox_dm_claims(user_id,claim_id,inbox_id,model,message_hash)
    values(actor,p_hash,(entry->>'id')::uuid,coalesce(p_model,'kiikii'),p_hash) on conflict do nothing;
  end loop;

  if p_message_at is not null then
    -- Recompute both sides from event time, not arrival order. A pair is valid only
    -- when BOTH nodes have exactly one possible partner. A late competing event
    -- therefore removes the prior automatic guess instead of stealing a pairing.
    for share in select * from public.reel_inbox_dm_receipts r
      where r.user_id=actor and r.sender=p_username and r.link_count>0 and r.explicit_model is null
        and not r.routing_locked and r.message_at between p_message_at-interval '30 seconds' and p_message_at+interval '30 seconds'
    loop
      select count(*),min(r.message_hash),min(r.explicit_model) into matches,match_hash,matched_model
      from public.reel_inbox_dm_receipts r
      where r.user_id=actor and r.sender=p_username and r.link_count=0 and r.explicit_model is not null
        and not r.routing_locked and (r.diagnostics->>'attachment_count')::integer=0
        and not (r.diagnostics->>'unsupported')::boolean
        and r.message_at between share.message_at and share.message_at+interval '30 seconds';
      reverse_matches:=0;
      if matches=1 then
        select * into note from public.reel_inbox_dm_receipts where user_id=actor and message_hash=match_hash;
        select count(*) into reverse_matches from public.reel_inbox_dm_receipts r
          where r.user_id=actor and r.sender=p_username and r.link_count>0
            and r.message_at between note.message_at-interval '30 seconds' and note.message_at;
      end if;
      final_model:=case when matches=1 and reverse_matches=1 then matched_model else 'kiikii' end;
      update public.reel_inbox_dm_receipts set model=final_model,
        routing_status=case when matches=1 and reverse_matches=1 then 'paired' else 'default' end,
        paired_message_hash=case when matches=1 and reverse_matches=1 then match_hash else null end
        where user_id=actor and message_hash=share.message_hash;
      update public.reel_inbox_dm_claims set model=final_model where user_id=actor and message_hash=share.message_hash;
    end loop;
    for note in select * from public.reel_inbox_dm_receipts r
      where r.user_id=actor and r.sender=p_username and r.link_count=0 and r.explicit_model is not null
        and not r.routing_locked and (r.diagnostics->>'attachment_count')::integer=0
        and not (r.diagnostics->>'unsupported')::boolean
        and r.message_at between p_message_at-interval '30 seconds' and p_message_at+interval '30 seconds'
    loop
      select count(*),min(r.message_hash) into matches,match_hash from public.reel_inbox_dm_receipts r
        where r.user_id=actor and r.sender=p_username and r.link_count>0
          and r.message_at between note.message_at-interval '30 seconds' and note.message_at;
      reverse_matches:=0;
      if matches=1 then
        select * into share from public.reel_inbox_dm_receipts where user_id=actor and message_hash=match_hash;
        if share.explicit_model is null and not share.routing_locked then
        select count(*) into reverse_matches from public.reel_inbox_dm_receipts r
          where r.user_id=actor and r.sender=p_username and r.link_count=0 and r.explicit_model is not null
            and not r.routing_locked and (r.diagnostics->>'attachment_count')::integer=0
            and not (r.diagnostics->>'unsupported')::boolean
            and r.message_at between share.message_at and share.message_at+interval '30 seconds';
        end if;
      end if;
      final_status:=case when matches=1 and reverse_matches=1 then 'note_applied'
        when matches>0 then 'note_ambiguous'
        when note.message_at<now()-interval '30 seconds' then 'note_expired' else 'note_pending' end;
      update public.reel_inbox_dm_receipts set routing_status=final_status,
        paired_message_hash=case when final_status='note_applied' then match_hash else null end
        where user_id=actor and message_hash=note.message_hash;
    end loop;
  end if;
  -- Project provenance; duplicates and independent model choices remain intact.
  insert into public.reel_inbox_dm_candidates(user_id,inbox_id,model,created_at)
    select user_id,inbox_id,model,min(created_at) from public.reel_inbox_dm_claims where user_id=actor
    group by user_id,inbox_id,model on conflict do nothing;
  delete from public.reel_inbox_dm_candidates c where c.user_id=actor and not exists (
    select 1 from public.reel_inbox_dm_claims cl where cl.user_id=c.user_id and cl.inbox_id=c.inbox_id and cl.model=c.model
  );
  select routing_status,model into final_status,final_model from public.reel_inbox_dm_receipts where user_id=actor and message_hash=p_hash;
  return result||jsonb_build_object('routing_status',final_status,'model',final_model);
end $$;
revoke all on function public.reel_inbox_dm_ingest_v4(text,text,text,text,jsonb,jsonb,text,timestamptz) from public,anon,authenticated;
grant execute on function public.reel_inbox_dm_ingest_v4(text,text,text,text,jsonb,jsonb,text,timestamptz) to service_role;

create function public.reel_inbox_dm_reassign(p_user uuid,p_inbox uuid,p_from_model text,p_to_model text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare src public.reel_inbox_dm_sources; affected text[];
begin
  if current_user not in ('service_role','postgres') then raise exception 'service required'; end if;
  select * into src from public.reel_inbox_dm_sources where user_id=p_user for update;
  if not found or not exists(select 1 from public.user_roles where user_id=p_user and role in ('owner','cofounder'))
    then raise exception 'operator required'; end if;
  if p_from_model is null or p_to_model is null or p_from_model not in ('kiikii','tuuva') or p_to_model not in ('kiikii','tuuva')
    then raise exception 'invalid model'; end if;
  if not exists(select 1 from public.reel_inbox_items where user_id=p_user and id=p_inbox) then raise exception 'not found'; end if;
  perform 1 from public.reel_inbox_dm_candidates where user_id=p_user and inbox_id=p_inbox and model=p_from_model for update;
  if not found then
    if exists(select 1 from public.reel_inbox_dm_candidates where user_id=p_user and inbox_id=p_inbox and model=p_to_model)
      then return '{"ok":true,"unchanged":true}'; end if;
    raise exception 'not collected';
  end if;
  if p_from_model=p_to_model then return '{"ok":true,"unchanged":true}'; end if;
  -- Also adopt old-v3 collections created after the initial migration backfill.
  insert into public.reel_inbox_dm_claims(user_id,claim_id,inbox_id,model,created_at)
  select c.user_id,'legacy:'||gen_random_uuid()::text,c.inbox_id,c.model,c.created_at
    from public.reel_inbox_dm_candidates c where c.user_id=p_user and c.inbox_id=p_inbox and not exists (
      select 1 from public.reel_inbox_dm_claims cl where cl.user_id=c.user_id and cl.inbox_id=c.inbox_id and cl.model=c.model
    ) on conflict do nothing;
  select array_agg(distinct message_hash) into affected from public.reel_inbox_dm_claims
    where user_id=p_user and inbox_id=p_inbox and model=p_from_model and message_hash is not null;
  -- Freeze these event pairs before changing just the selected collected row.
  update public.reel_inbox_dm_receipts r set routing_locked=true,routing_status='manual'
    where r.user_id=p_user and (r.message_hash=any(affected) or r.paired_message_hash=any(affected)
      or (r.link_count=0 and r.explicit_model is not null and exists (
        select 1 from public.reel_inbox_dm_receipts s where s.user_id=p_user
          and s.message_hash=any(affected) and s.sender=r.sender
          and r.message_at between s.message_at and s.message_at+interval '30 seconds'
      )));
  update public.reel_inbox_dm_claims set model=p_to_model where user_id=p_user and inbox_id=p_inbox and model=p_from_model;
  update public.reel_inbox_dm_receipts r set paired_message_hash=null,
    model=(select case when count(distinct c.model)=1 then min(c.model) else null end
      from public.reel_inbox_dm_claims c where c.user_id=r.user_id and c.message_hash=r.message_hash)
    where r.user_id=p_user and r.message_hash=any(affected);
  insert into public.reel_inbox_dm_candidates(user_id,inbox_id,model,created_at)
    select user_id,inbox_id,model,min(created_at) from public.reel_inbox_dm_claims where user_id=p_user and inbox_id=p_inbox
    group by user_id,inbox_id,model on conflict do nothing;
  delete from public.reel_inbox_dm_candidates c where c.user_id=p_user and c.inbox_id=p_inbox and not exists (
    select 1 from public.reel_inbox_dm_claims cl where cl.user_id=c.user_id and cl.inbox_id=c.inbox_id and cl.model=c.model
  );
  return jsonb_build_object('ok',true,'model',p_to_model);
end $$;
revoke all on function public.reel_inbox_dm_reassign(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.reel_inbox_dm_reassign(uuid,uuid,text,text) to service_role;
