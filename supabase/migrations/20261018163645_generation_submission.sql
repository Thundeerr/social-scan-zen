create table public.generation_uploads (
 id uuid primary key, user_id uuid not null references auth.users(id),
 model text not null check(model in ('kiikii','tuuva')),
 path text not null unique, created_at timestamptz not null default now(),
 unique(id,user_id,model),
 foreign key(user_id,model) references public.model_pipeline_profiles(user_id,model)
);
alter table public.generation_uploads enable row level security;
revoke all on public.generation_uploads from public,anon,authenticated;
grant all on public.generation_uploads to service_role;
create index generation_uploads_owner on public.generation_uploads(user_id,created_at);
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('generation-sources','generation-sources',false,41943040,array['video/mp4']);
alter table public.model_pipeline_jobs alter column inbox_id drop not null;
alter table public.model_pipeline_jobs add column source_upload_id uuid;
alter table public.model_pipeline_jobs add column source_sha256 text check(source_sha256 ~ '^[a-f0-9]{64}$');
alter table public.model_pipeline_jobs add foreign key(source_upload_id,user_id,model)
 references public.generation_uploads(id,user_id,model);
alter table public.model_pipeline_jobs add unique(user_id,model,source_upload_id);
alter table public.model_pipeline_jobs add check(
 (inbox_id is not null and source_upload_id is null and source_sha256 is null) or
 (inbox_id is null and source_upload_id is not null and source_sha256 is not null));
comment on table public.generation_uploads is 'Private source uploads; only finalized uploads become generation jobs.';

create function public.generation_submit(p_user uuid,p_action text,p_data jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare cfg public.model_pipeline_settings; upload public.generation_uploads;
 job public.model_pipeline_jobs; result jsonb; inbox uuid; character text:=p_data->>'model';
begin
 if current_user not in ('service_role','postgres') or p_user is null
 or not exists(select 1 from public.user_roles where user_id=p_user and role='owner')
 then raise exception 'Owner required'; end if;
 select * into cfg from public.model_pipeline_settings where user_id=p_user for update;
 if not found or character is null or not exists(select 1 from public.model_pipeline_profiles where user_id=p_user and model=character)
 then raise exception 'Model pipeline not configured'; end if;
 if p_action='prepare' then
   select * into upload from public.generation_uploads where id=(p_data->>'id')::uuid;
   if found then
     if upload.user_id<>p_user or upload.model<>character then raise exception 'Upload conflict'; end if;
   else
     insert into public.generation_uploads(id,user_id,model,path)
     values((p_data->>'id')::uuid,p_user,character,p_user::text||'/'||(p_data->>'id')||'.mp4') returning * into upload;
   end if;
   return to_jsonb(upload);
 elsif p_action='upload' then
   select * into upload from public.generation_uploads where id=(p_data->>'id')::uuid and user_id=p_user and model=character;
   if not found then raise exception 'Upload not found'; end if;
   if coalesce(p_data->>'sha256','') !~ '^[a-f0-9]{64}$' then raise exception 'Invalid hash'; end if;
   insert into public.model_pipeline_jobs(user_id,model,source_upload_id,source_sha256)
   values(p_user,character,upload.id,p_data->>'sha256') on conflict do nothing;
   select * into job from public.model_pipeline_jobs where user_id=p_user and model=character and source_upload_id=upload.id;
   if job.source_sha256<>p_data->>'sha256' then raise exception 'Upload changed'; end if;
 elsif p_action='link' then
   if coalesce(p_data->>'shortcode','') !~ '^[A-Za-z0-9_-]{5,64}$'
     or p_data->>'url' not in ('https://www.instagram.com/reel/'||(p_data->>'shortcode')||'/',
       'https://www.instagram.com/p/'||(p_data->>'shortcode')||'/')
     or p_data->>'url' is null then raise exception 'Invalid Reel'; end if;
   result:=public.reel_inbox_command('submit',p_user,jsonb_build_object('links',jsonb_build_array(
     jsonb_build_object('url',p_data->>'url','shortcode',p_data->>'shortcode')),'test',false));
   inbox:=(result->0->>'id')::uuid;
   if inbox is null then raise exception 'Intake failed'; end if;
   insert into public.model_pipeline_jobs(user_id,model,inbox_id) values(p_user,character,inbox) on conflict do nothing;
   select * into job from public.model_pipeline_jobs where user_id=p_user and model=character and inbox_id=inbox;
 else raise exception 'Invalid action'; end if;
 return jsonb_build_object('id',job.id,'state',job.state,'enabled',cfg.enabled);
end $$;
revoke all on function public.generation_submit(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.generation_submit(uuid,text,jsonb) to service_role;

-- Existing worker command unchanged except fallback review title for uploads.
create or replace function public.model_pipeline_command(p_action text,p_user uuid default null,p_data jsonb default '{}',p_worker_hash text default null)
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
        review:=public.content_review_command(actor,'create',jsonb_build_object('model',job.model,'title',initcap(job.model)||' · '||coalesce((select shortcode from public.reel_inbox_items where id=job.inbox_id),'Upload'),'caption',coalesce(p_data->>'caption','')));
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
