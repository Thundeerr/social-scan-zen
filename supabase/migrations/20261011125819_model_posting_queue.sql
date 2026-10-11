-- Preserve the existing immutable-media publishing checks; scheduling wraps them
-- in one transaction so no worker can observe the temporary immediate timestamp.
alter function public.model_publish_command(uuid,text,jsonb) rename to model_publish_immediate_command;
revoke all on function public.model_publish_immediate_command(uuid,text,jsonb) from public,anon,authenticated;

create or replace function public.model_publish_command(p_user uuid,p_action text,p_data jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare item public.content_review_items; post public.content_posts; account public.ig_connections;
 result jsonb; chosen timestamptz; local_choice timestamp;
begin
 if current_user not in ('postgres','service_role') or p_user is null or not exists(select 1 from public.user_roles where user_id=p_user and role='owner') then raise exception 'owner required'; end if;
 if p_action='queue' then
  return jsonb_build_object('queue',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'revision',r.revision,'title',r.title,'model',r.model,'scheduled_for',p.scheduled_for,'status',p.status,'publish_mode',p.publish_mode) order by p.scheduled_for) from public.content_posts p join public.content_review_items r on r.publish_post_id=p.id where p.user_id=p_user and r.user_id=p_user and p.status in ('scheduled','publishing')),'[]'::jsonb),'timezone','Europe/Berlin');
 end if;
 select * into item from public.content_review_items where id=(p_data->>'id')::uuid and user_id=p_user for update;
 if not found then raise exception 'not found'; end if;
 if p_action='status' then
  result:=public.model_publish_immediate_command(p_user,p_action,p_data);
  return result||jsonb_build_object('scheduled_for',(select scheduled_for from public.content_posts where id=item.publish_post_id),'timezone','Europe/Berlin');
 end if;
 if p_action not in ('schedule_preview','schedule','unschedule') then
  return public.model_publish_immediate_command(p_user,p_action,p_data);
 end if;
 if item.revision is distinct from (p_data->>'revision')::int then raise exception 'Review changed'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user::text||':'||item.model,0));
 select * into post from public.content_posts where id=item.publish_post_id and user_id=p_user for update;
 if post.id is null then raise exception 'Prepare publication first'; end if;
 if p_action='unschedule' then
  if post.status<>'scheduled' or exists(select 1 from public.content_publications where content_post_id=post.id and (platform_media_id is not null or platform_container_id is not null or status<>'pending')) then raise exception 'Publication already started'; end if;
  update public.content_posts set status='approved',scheduled_for=null where id=post.id;
  insert into public.content_events(content_post_id,event_type,detail) values(post.id,'model_schedule_cancelled','{}');
  return jsonb_build_object('post_id',post.id);
 end if;
 if p_action='schedule' then
  if p_data->>'confirmation' is distinct from 'SCHEDULE' or p_data->>'publish_mode' is distinct from post.publish_mode or p_data->>'ig_user_id' is distinct from post.target_ig_user_id then raise exception 'Confirm exact schedule, mode and account'; end if;
  chosen:=(p_data->>'scheduled_for')::timestamptz;
  if post.status in ('scheduled','publishing','published') and post.scheduled_for=chosen then return jsonb_build_object('post_id',post.id); end if;
 elsif p_data->>'local_time' is not null then
  if p_data->>'local_time' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$' then raise exception 'Invalid local date'; end if;
  local_choice:=(p_data->>'local_time')::timestamp;
  chosen:=local_choice at time zone 'Europe/Berlin';
  if chosen at time zone 'Europe/Berlin' <> local_choice then raise exception 'This local time does not exist'; end if;
 else
  select min(slot) into chosen from (
   select ((now() at time zone 'Europe/Berlin')::date+d+clock) at time zone 'Europe/Berlin' as slot
   from generate_series(0,59) d cross join (values(time '00:00'),(time '19:00')) clocks(clock)
  ) slots where slot>now()+interval '2 minutes' and not exists(select 1 from public.content_posts p where p.user_id=p_user and p.destination=item.model and p.status in ('scheduled','publishing','published') and p.scheduled_for>=slot-interval '59 seconds' and p.scheduled_for<=slot+interval '59 seconds');
 end if;
 if post.status<>'approved' or item.status<>'approved' then raise exception 'Fresh approval required'; end if;
 if chosen is null or chosen<=now()+interval '2 minutes' or chosen>now()+interval '60 days' then raise exception 'Choose a future time within 60 days'; end if;
 if exists(select 1 from public.content_posts p where p.user_id=p_user and p.destination=item.model and p.id<>post.id and p.status in ('scheduled','publishing','published') and p.scheduled_for>=chosen-interval '59 seconds' and p.scheduled_for<=chosen+interval '59 seconds') then raise exception 'Slot taken; refresh preview'; end if;
 select * into account from public.ig_connections where user_id=p_user and destination=item.model;
 if account.id is null or account.status<>'active' or account.ig_user_id<>post.target_ig_user_id or account.token_expires_at<=chosen+interval '6 hours' then raise exception 'Connection must remain valid beyond the selected time'; end if;
 if p_action='schedule_preview' then return jsonb_build_object('scheduled_for',chosen,'timezone','Europe/Berlin'); end if;
 perform public.model_publish_immediate_command(p_user,'publish',p_data||jsonb_build_object('confirmation','PUBLISH'));
 update public.content_posts set scheduled_for=chosen where id=post.id;
 insert into public.content_events(content_post_id,event_type,detail) values(post.id,'model_schedule_authorized',jsonb_build_object('review_id',item.id,'revision',item.revision,'scheduled_for',chosen,'timezone','Europe/Berlin'));
 return jsonb_build_object('post_id',post.id,'scheduled_for',chosen);
end $$;
revoke all on function public.model_publish_command(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.model_publish_command(uuid,text,jsonb) to service_role;
