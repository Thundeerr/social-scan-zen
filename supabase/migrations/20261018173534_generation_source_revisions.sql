-- Bring the existing production revision schema into migration history without
-- replaying its historical one-off job insert. Fresh databases get the same flow.
alter table public.model_pipeline_jobs
 add column if not exists attempt integer not null default 0 check(attempt>=0),
 add column if not exists parent_job_id uuid references public.model_pipeline_jobs(id),
 add column if not exists revision_of_review_id uuid unique references public.content_review_items(id),
 add column if not exists revision_notes text not null default '',
 add column if not exists revision_caption text;

-- Initial submission is attempt 0; each revision retains its source and hash.
-- NULL source columns are allowed only as defined by the existing source XOR check.
alter table public.model_pipeline_jobs
 drop constraint if exists model_pipeline_jobs_user_id_model_inbox_id_key,
 drop constraint if exists model_pipeline_jobs_user_id_model_source_upload_id_key;
create unique index if not exists model_pipeline_jobs_source_attempt_key
 on public.model_pipeline_jobs(user_id,model,inbox_id,attempt);
create unique index model_pipeline_jobs_upload_attempt_key
 on public.model_pipeline_jobs(user_id,model,source_upload_id,attempt);
comment on index public.model_pipeline_jobs_upload_attempt_key is
 'One job per upload and revision attempt; repeated initial submissions remain deduplicated.';

create or replace function public.enqueue_model_revision() returns trigger
language plpgsql set search_path='' as $body$
declare parent public.model_pipeline_jobs;
begin
 if NEW.status='changes' and OLD.status is distinct from NEW.status then
  select * into parent from public.model_pipeline_jobs where review_id=NEW.id and user_id=NEW.user_id and model=NEW.model for update;
  if found then
   insert into public.model_pipeline_jobs(user_id,model,inbox_id,source_upload_id,source_sha256,attempt,parent_job_id,revision_of_review_id,revision_notes,revision_caption)
   values(parent.user_id,parent.model,parent.inbox_id,parent.source_upload_id,parent.source_sha256,parent.attempt+1,parent.id,NEW.id,
     concat_ws(E'\n',nullif(parent.revision_notes,''),'Revision '||(parent.attempt+1)::text||': '||NEW.note),NEW.caption)
   on conflict(revision_of_review_id) do nothing;
  end if;
 end if;
 return NEW;
end $body$;
revoke all on function public.enqueue_model_revision() from public,anon,authenticated;
drop trigger if exists enqueue_model_revision on public.content_review_items;
create trigger enqueue_model_revision after update of status on public.content_review_items
for each row execute function public.enqueue_model_revision();
create or replace function public.label_model_revision() returns trigger
language plpgsql set search_path='' as $body$
begin
 if NEW.attempt>0 and NEW.review_id is not null and OLD.review_id is distinct from NEW.review_id then
  update public.content_review_items set title=title||' · Überarbeitung '||NEW.attempt::text
  where id=NEW.review_id and user_id=NEW.user_id and status='uploading';
 end if;
 return NEW;
end $body$;
revoke all on function public.label_model_revision() from public,anon,authenticated;
drop trigger if exists label_model_revision on public.model_pipeline_jobs;
create trigger label_model_revision after update of review_id on public.model_pipeline_jobs
for each row execute function public.label_model_revision();

-- Re-submission must return the original job, never an arbitrary revision.
create or replace function public.generation_submit(p_user uuid,p_action text,p_data jsonb)
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
   insert into public.model_pipeline_jobs(user_id,model,inbox_id) values(p_user,character,inbox) on conflict do nothing;
   select * into job from public.model_pipeline_jobs where user_id=p_user and model=character and inbox_id=inbox and attempt=0;
 else raise exception 'Invalid action'; end if;
 return jsonb_build_object('id',job.id,'state',job.state,'enabled',cfg.enabled);
end $$;
revoke all on function public.generation_submit(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.generation_submit(uuid,text,jsonb) to service_role;

