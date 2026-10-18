begin;
alter table public.model_pipeline_jobs
 add column attempt integer not null default 0 check(attempt>=0),
 add column parent_job_id uuid references public.model_pipeline_jobs(id),
 add column revision_of_review_id uuid unique references public.content_review_items(id),
 add column revision_notes text not null default '',
 add column revision_caption text;
alter table public.model_pipeline_jobs drop constraint model_pipeline_jobs_user_id_model_inbox_id_key;
alter table public.model_pipeline_jobs add constraint model_pipeline_jobs_source_attempt_key unique(user_id,model,inbox_id,attempt);
create or replace function public.enqueue_model_revision() returns trigger
language plpgsql set search_path='' as $body$
declare parent public.model_pipeline_jobs;
begin
 if NEW.status='changes' and OLD.status is distinct from NEW.status then
  select * into parent from public.model_pipeline_jobs where review_id=NEW.id and user_id=NEW.user_id and model=NEW.model for update;
  if found then
   insert into public.model_pipeline_jobs(user_id,model,inbox_id,attempt,parent_job_id,revision_of_review_id,revision_notes,revision_caption)
   values(parent.user_id,parent.model,parent.inbox_id,parent.attempt+1,parent.id,NEW.id,
     concat_ws(E'\n',nullif(parent.revision_notes,''),'Revision '||(parent.attempt+1)::text||': '||NEW.note),NEW.caption)
   on conflict(revision_of_review_id) do nothing;
  end if;
 end if;
 return NEW;
end $body$;
revoke all on function public.enqueue_model_revision() from public,anon,authenticated;
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
create trigger label_model_revision after update of review_id on public.model_pipeline_jobs
for each row execute function public.label_model_revision();
insert into public.model_pipeline_jobs(user_id,model,inbox_id,attempt,parent_job_id,revision_of_review_id,revision_notes,revision_caption)
select j.user_id,j.model,j.inbox_id,j.attempt+1,j.id,r.id,'Revision 1: '||r.note,r.caption
from public.model_pipeline_jobs j join public.content_review_items r on r.id=j.review_id
where r.id='74048218-7ec2-4ce3-81bc-205b30269be9' and r.status='changes'
on conflict(revision_of_review_id) do nothing;
commit;
