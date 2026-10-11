-- Durable model-specific intake, conservative shared daily budget and scoped worker pairing.
create table public.model_pipeline_settings (
  user_id uuid primary key references auth.users(id),
  enabled boolean not null default false,
  daily_cents integer not null default 300 check(daily_cents between 0 and 300),
  resolution text not null default '720p' check(resolution='720p'),
  worker_hash text unique check(worker_hash ~ '^[a-f0-9]{64}$'),
  last_seen_at timestamptz
);
create table public.model_pipeline_profiles (
  user_id uuid not null references public.model_pipeline_settings(user_id),
  model text not null check(model in ('kiikii','tuuva')),
  sender_username text check(sender_username ~ '^[a-z0-9_.]{1,30}$'),
  intake_after timestamptz not null default now(),
  primary key(user_id,model), unique(user_id,sender_username)
);
create table public.model_pipeline_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.model_pipeline_settings(user_id),
  model text not null,
  inbox_id uuid not null references public.reel_inbox_items(id),
  state text not null default 'queued' check(state in ('queued','working','budget_wait','reserved','generating','review','blocked')),
  lease uuid, lease_until timestamptz,
  reserved_day date, reserved_cents integer not null default 0 check(reserved_cents between 0 and 300),
  duration integer check(duration between 2 and 15),
  provider_id text check(provider_id ~ '^[a-f0-9]{32}$'),
  review_id uuid unique references public.content_review_items(id),
  issue text check(issue in ('source_unavailable','duration','validation','provider_uncertain','provider_failed','setup')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key(user_id,model) references public.model_pipeline_profiles(user_id,model),
  unique(user_id,model,inbox_id)
);
create table public.model_pipeline_external_spend (
  user_id uuid not null references public.model_pipeline_settings(user_id),
  day date not null, reference text not null, cents integer not null check(cents>=0),
  primary key(user_id,reference)
);
alter table public.model_pipeline_settings enable row level security;
alter table public.model_pipeline_profiles enable row level security;
alter table public.model_pipeline_jobs enable row level security;
alter table public.model_pipeline_external_spend enable row level security;
revoke all on public.model_pipeline_settings,public.model_pipeline_profiles,public.model_pipeline_jobs,public.model_pipeline_external_spend from public,anon,authenticated;
grant all on public.model_pipeline_settings,public.model_pipeline_profiles,public.model_pipeline_jobs,public.model_pipeline_external_spend to service_role;

-- Keep legacy intake usable; additionally allow only explicitly mapped model usernames.
alter table public.reel_inbox_dm_senders drop constraint reel_inbox_dm_senders_username_check;
alter table public.reel_inbox_dm_receipts drop constraint reel_inbox_dm_receipts_sender_check;
alter table public.reel_inbox_dm_senders add check(username ~ '^[a-z0-9_.]{1,30}$');
alter table public.reel_inbox_dm_receipts add check(sender ~ '^[a-z0-9_.]{1,30}$');
create or replace function public.reel_inbox_dm_ingest(p_receiver text,p_sender text,p_username text,p_hash text,p_links jsonb)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare src public.reel_inbox_dm_sources; bound text; result jsonb; profile public.model_pipeline_profiles; entry jsonb;
begin
  select * into src from public.reel_inbox_dm_sources where receiver_id=p_receiver and enabled for update;
  if not found then return '{"ignored":true}'; end if;
  if not exists(select 1 from public.user_roles where user_id=src.user_id and role in ('owner','cofounder')) then return '{"ignored":true}'; end if;
  select * into profile from public.model_pipeline_profiles where user_id=src.user_id and sender_username=p_username;
  if p_username is null or (p_username not in ('kiikii.bat','thundeerr999') and profile.model is null) or p_sender is null or p_sender !~ '^[0-9]{1,40}$' then return '{"ignored":true}'; end if;
  select sender_id into bound from public.reel_inbox_dm_senders where user_id=src.user_id and username=p_username;
  if found and bound<>p_sender then return '{"ignored":true}'; end if;
  if exists(select 1 from public.reel_inbox_dm_senders where user_id=src.user_id and sender_id=p_sender and username<>p_username) then return '{"ignored":true}'; end if;
  if jsonb_typeof(p_links) is distinct from 'array' or jsonb_array_length(p_links)>50 then raise exception 'invalid links'; end if;
  insert into public.reel_inbox_dm_senders values(src.user_id,p_username,p_sender) on conflict do nothing;
  if exists(select 1 from public.reel_inbox_dm_receipts where user_id=src.user_id and message_hash=p_hash) then return '{"duplicate":true}'; end if;
  if (select count(*) from public.reel_inbox_dm_receipts where user_id=src.user_id)>=50000 then raise exception 'receipt limit'; end if;
  result:=public.reel_inbox_command('submit',src.user_id,jsonb_build_object('links',p_links,'test',false));
  insert into public.reel_inbox_dm_receipts(user_id,message_hash,sender,status,link_count)
  values(src.user_id,p_hash,p_username,case when jsonb_array_length(p_links)>0 then 'queued' else 'no_reel_link' end,jsonb_array_length(p_links));
  if profile.model is not null and now()>=profile.intake_after then
    for entry in select * from jsonb_array_elements(result) loop
      insert into public.model_pipeline_jobs(user_id,model,inbox_id)
      values(src.user_id,profile.model,(entry->>'id')::uuid) on conflict do nothing;
    end loop;
  end if;
  update public.reel_inbox_dm_sources set last_received_at=now() where user_id=src.user_id;
  return jsonb_build_object('results',result);
end $$;

create function public.model_pipeline_command(p_action text,p_user uuid default null,p_data jsonb default '{}',p_worker_hash text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare actor uuid; cfg public.model_pipeline_settings; job public.model_pipeline_jobs;
  today date := (now() at time zone 'Europe/Berlin')::date; cost integer; spent integer; review jsonb;
begin
  if current_user not in ('service_role','postgres') then raise exception 'service required'; end if;
  if p_worker_hash is not null then
    select * into cfg from public.model_pipeline_settings where worker_hash=p_worker_hash for update;
    if not found then raise exception 'worker denied'; end if;
    actor:=cfg.user_id;
    if p_action not in ('claim','get','reserve','submitted','block','review') then raise exception 'scope'; end if;
    update public.model_pipeline_settings set last_seen_at=now() where user_id=actor;
  else
    actor:=p_user;
    if p_action not in ('status','pair','pause','enable') then raise exception 'operator scope'; end if;
    select * into cfg from public.model_pipeline_settings where user_id=actor for update;
    if not found then raise exception 'not configured'; end if;
  end if;
  if not exists(select 1 from public.user_roles where user_id=actor and role='owner') then raise exception 'owner required'; end if;
  if p_action='status' then
    return jsonb_build_object('enabled',cfg.enabled,'resolution',cfg.resolution,'daily_cents',cfg.daily_cents,'last_seen_at',cfg.last_seen_at,
      'jobs',coalesce((select jsonb_agg(to_jsonb(j)-'lease'-'lease_until'-'user_id' order by created_at desc) from (select * from public.model_pipeline_jobs where user_id=actor order by created_at desc limit 50) j),'[]'),
      'profiles',(select jsonb_agg(to_jsonb(p)-'user_id') from public.model_pipeline_profiles p where user_id=actor));
  elsif p_action='pair' then
    if coalesce(p_data->>'hash','') !~ '^[a-f0-9]{64}$' then raise exception 'invalid hash'; end if;
    update public.model_pipeline_settings set worker_hash=p_data->>'hash',enabled=false where user_id=actor; return '{"ok":true}';
  elsif p_action in ('enable','pause') then
    if p_action='enable' and cfg.worker_hash is null then raise exception 'worker missing'; end if;
    update public.model_pipeline_settings set enabled=(p_action='enable') where user_id=actor; return '{"ok":true}';
  elsif p_action='claim' then
    if not cfg.enabled then return 'null'; end if;
    -- Paid or uncertain work is never reclaimed and therefore never submitted twice.
    select * into job from public.model_pipeline_jobs where user_id=actor and
      (state='queued' or (state='working' and lease_until<now()) or (state='budget_wait' and (updated_at at time zone 'Europe/Berlin')::date < today))
      order by created_at for update skip locked limit 1;
    if not found then return 'null'; end if;
    update public.model_pipeline_jobs set state='working',lease=gen_random_uuid(),lease_until=now()+interval '20 minutes',updated_at=now() where id=job.id returning * into job;
  else
    select * into job from public.model_pipeline_jobs where id=(p_data->>'id')::uuid and user_id=actor for update;
    if not found or job.lease is distinct from (p_data->>'lease')::uuid then raise exception 'lease denied'; end if;
    if p_action='reserve' then
      if not cfg.enabled or job.state<>'working' or job.lease_until<now() then raise exception 'not claimable'; end if;
      if p_data->>'seconds' is null or (p_data->>'seconds')::numeric not between 2 and 15 then raise exception 'duration'; end if;
      cost:=ceil((p_data->>'seconds')::numeric)::integer*20;
      select coalesce(sum(reserved_cents),0) into spent from public.model_pipeline_jobs where user_id=actor and reserved_day=today;
      spent:=spent+coalesce((select sum(cents) from public.model_pipeline_external_spend where user_id=actor and day=today),0);
      if spent+cost>cfg.daily_cents or (now() at time zone 'Europe/Berlin')::time >= time '23:58' then
        update public.model_pipeline_jobs set state='budget_wait',updated_at=now() where id=job.id;
        return jsonb_build_object('budget_wait',true,'remaining_cents',greatest(0,cfg.daily_cents-spent));
      end if;
      update public.model_pipeline_jobs set state='reserved',reserved_day=today,reserved_cents=cost,duration=ceil((p_data->>'seconds')::numeric),updated_at=now() where id=job.id returning * into job;
    elsif p_action='submitted' then
      if job.state not in ('reserved','generating') or (job.provider_id is not null and job.provider_id is distinct from p_data->>'provider_id') then raise exception 'already submitted'; end if;
      update public.model_pipeline_jobs set state='generating',provider_id=p_data->>'provider_id',updated_at=now() where id=job.id returning * into job;
    elsif p_action='block' then
      if job.state='review' then raise exception 'already delivered'; end if;
      update public.model_pipeline_jobs set state='blocked',issue=p_data->>'issue',updated_at=now() where id=job.id returning * into job;
    elsif p_action='review' then
      if job.state not in ('generating','review') then raise exception 'not generated'; end if;
      if job.review_id is null then
        review:=public.content_review_command(actor,'create',jsonb_build_object('model',job.model,'title',initcap(job.model)||' · '||(select shortcode from public.reel_inbox_items where id=job.inbox_id),'caption',coalesce(p_data->>'caption','')));
        update public.model_pipeline_jobs set review_id=(review->>'id')::uuid,updated_at=now() where id=job.id returning * into job;
      end if;
      if exists(select 1 from public.content_review_items where id=job.review_id and status<>'uploading') then
        update public.model_pipeline_jobs set state='review',updated_at=now() where id=job.id returning * into job;
      end if;
    end if;
  end if;
  return to_jsonb(job) || jsonb_build_object('source_url',(select canonical_url from public.reel_inbox_items where id=job.inbox_id),'resolution',cfg.resolution);
end $$;
revoke all on function public.model_pipeline_command(text,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.model_pipeline_command(text,uuid,jsonb,text) to service_role;
