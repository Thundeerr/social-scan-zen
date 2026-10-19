-- A model-profile pointer, not client-supplied image URLs. Existing RLS and
-- service-role-only job writes remain unchanged.
alter table public.model_pipeline_jobs
 add column reference_profile text,
 add column prompt_id text check(prompt_id in ('prompt_1','prompt_2'));
update public.model_pipeline_jobs set reference_profile=model;
alter table public.model_pipeline_jobs
 alter column reference_profile set not null,
 add constraint model_pipeline_job_reference_model check(reference_profile=model);
comment on column public.model_pipeline_jobs.reference_profile is
 'Key in the worker-owned models.json; references are resolved and SHA-256 checked by the worker. Not an image snapshot.';
comment on column public.model_pipeline_jobs.prompt_id is
 'Selected prompt key; text stays in the worker model configuration. NULL is reserved for legacy jobs.';

create function public.bind_generation_inputs() returns trigger
language plpgsql security invoker set search_path='' as $$
declare parent public.model_pipeline_jobs;
begin
 if NEW.reference_profile is null then NEW.reference_profile:=NEW.model; end if;
 if NEW.parent_job_id is not null then
  select * into parent from public.model_pipeline_jobs
   where id=NEW.parent_job_id and user_id=NEW.user_id and model=NEW.model;
  if not found then raise exception 'Invalid revision parent'; end if;
  NEW.reference_profile:=parent.reference_profile;
  NEW.prompt_id:=parent.prompt_id;
 end if;
 return NEW;
end $$;
revoke all on function public.bind_generation_inputs() from public,anon,authenticated;
create trigger bind_generation_inputs before insert on public.model_pipeline_jobs
 for each row execute function public.bind_generation_inputs();

-- Preserve intake, initial-job idempotency and revision behavior.
create or replace function public.generation_submit_core(p_user uuid,p_action text,p_data jsonb)
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
 if p_action in ('link','upload') and coalesce(p_data->>'prompt_id','') not in ('prompt_1','prompt_2') then raise exception 'Invalid prompt identifier'; end if;
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
   insert into public.model_pipeline_jobs(user_id,model,source_upload_id,source_sha256,prompt_id)
   values(p_user,character,upload.id,p_data->>'sha256',p_data->>'prompt_id') on conflict do nothing;
   select * into job from public.model_pipeline_jobs where user_id=p_user and model=character and source_upload_id=upload.id and attempt=0;
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
   insert into public.model_pipeline_jobs(user_id,model,inbox_id,prompt_id) values(p_user,character,inbox,p_data->>'prompt_id') on conflict do nothing;
   select * into job from public.model_pipeline_jobs where user_id=p_user and model=character and inbox_id=inbox and attempt=0;
 else raise exception 'Invalid action'; end if;
 return jsonb_build_object('id',job.id,'state',job.state,'enabled',cfg.enabled);
end $$;
revoke all on function public.generation_submit_core(uuid,text,jsonb) from public,anon,authenticated,service_role;
-- Only the existing atomic duplicate-check wrapper can call this core.

