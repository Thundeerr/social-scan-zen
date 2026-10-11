alter table public.content_review_items add column publish_post_id uuid unique references public.content_posts(id);
alter table public.content_posts add column target_ig_user_id text;

create function public.guard_model_post() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if old.destination<>'followerstar' then
  if current_user not in ('postgres','service_role') then raise exception 'Use the model review workflow'; end if;
  if TG_OP='UPDATE' and (new.target_ig_user_id is distinct from old.target_ig_user_id or new.caption is distinct from old.caption or new.media_sha256 is distinct from old.media_sha256 or new.reel_storage_path is distinct from old.reel_storage_path or new.user_id is distinct from old.user_id) then raise exception 'Prepared media, caption and target are immutable'; end if;
 end if;
 if TG_OP='DELETE' then return old; end if;
 return new;
end $$;
revoke all on function public.guard_model_post() from public,anon,authenticated;
create trigger model_post_guard before update or delete on public.content_posts for each row execute function public.guard_model_post();

create function public.lock_transferred_review() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if old.publish_post_id is not null and (new.caption<>old.caption or new.revision<>old.revision or new.status<>old.status or new.media_path<>old.media_path or new.model<>old.model) then
  raise exception 'Cancel the prepared publication before editing its review';
 end if;
 return new;
end $$;
revoke all on function public.lock_transferred_review() from public,anon,authenticated;
create trigger lock_transferred_review before update on public.content_review_items for each row execute function public.lock_transferred_review();

create function public.model_publish_command(p_user uuid,p_action text,p_data jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare item public.content_review_items; post public.content_posts; account public.ig_connections; path text;
begin
 if current_user not in ('postgres','service_role') or p_user is null or not exists(select 1 from public.user_roles where user_id=p_user and role='owner') then raise exception 'owner required'; end if;
 select * into item from public.content_review_items where id=(p_data->>'id')::uuid and user_id=p_user for update;
 if not found then raise exception 'not found'; end if;
 if p_action<>'status' and item.revision is distinct from (p_data->>'revision')::int then raise exception 'Review changed; refresh first'; end if;
 select * into account from public.ig_connections where user_id=p_user and destination=item.model;
 if item.publish_post_id is not null then select * into post from public.content_posts where id=item.publish_post_id and user_id=p_user for update; end if;
 if p_action='status' then
  return jsonb_build_object('post_id',post.id,'status',post.status,'username',account.ig_username,'ig_user_id',account.ig_user_id,
   'connected',account.status='active' and account.token_expires_at>now()+interval '6 hours',
   'paused',coalesce((select publishing_paused from public.profiles where id=p_user),true),
   'error',case when post.status='failed' then 'Veröffentlichung gestoppt. Bitte prüfen; kein automatischer Neuversuch.' else null end,
   'permalink',(select permalink from public.content_publications where content_post_id=post.id and channel='reel' and status='published'));
 end if;
 if p_action='cancel' then
  if post.id is null or post.status<>'approved' or exists(select 1 from public.content_publications where content_post_id=post.id and platform_media_id is not null) then raise exception 'Only a prepared unpublished post can be cancelled'; end if;
  update public.content_review_items set publish_post_id=null where id=item.id;
  delete from public.content_posts where id=post.id;
 elsif p_action='prepare' then
  if item.status<>'approved' or item.sha256 is null or length(btrim(item.caption))=0 then raise exception 'Approve video and caption first'; end if;
  if post.id is not null then return jsonb_build_object('post_id',post.id); end if;
  if account.id is null or account.status<>'active' or account.token_expires_at<=now()+interval '6 hours' then raise exception 'Connect this model to Instagram first'; end if;
  path:=p_user::text||'/model-review/'||item.id::text||'/'||item.sha256||'.mp4';
  if p_data->>'storage_path' is distinct from path or p_data->>'sha256' is distinct from item.sha256 then raise exception 'Media identity mismatch'; end if;
  insert into public.content_posts(user_id,post_key,title,caption,status,approved_at,approved_by,destination,target_ig_user_id,reel_storage_path,media_sha256,highlight_enabled,share_to_feed,story_publish_mode)
  values(p_user,'model-review-'||item.id::text,item.title,item.caption,'approved',item.reviewed_at,p_user,item.model,account.ig_user_id,path,item.sha256,false,true,'manual_link_sticker') returning * into post;
  insert into public.content_publications(content_post_id,channel) values(post.id,'reel');
  update public.content_review_items set publish_post_id=post.id where id=item.id;
  insert into public.content_events(content_post_id,event_type,detail) values(post.id,'model_review_prepared',jsonb_build_object('review_id',item.id,'revision',item.revision,'destination',item.model,'username',account.ig_username));
 elsif p_action='publish' then
  if post.id is null then raise exception 'Prepare publication first'; end if;
  if p_data->>'confirmation' is distinct from 'PUBLISH' or p_data->>'ig_user_id' is distinct from post.target_ig_user_id then raise exception 'Confirm the exact Instagram destination'; end if;
  -- Repeated clicks return the existing job; failed/ambiguous jobs are not retried here.
  if post.status in ('scheduled','publishing','published') then return jsonb_build_object('post_id',post.id,'status',post.status); end if;
  if post.status<>'approved' or item.status<>'approved' or post.caption<>item.caption or post.media_sha256<>item.sha256 then raise exception 'Fresh review required'; end if;
  if account.id is null or account.ig_user_id<>post.target_ig_user_id or account.status<>'active' or account.token_expires_at<=now()+interval '6 hours' then raise exception 'Model connection is not ready'; end if;
  if not exists(select 1 from public.profiles where id=p_user and publishing_paused=false) then raise exception 'Cloud publishing is paused'; end if;
  update public.content_posts set status='scheduled',scheduled_for=now() where id=post.id;
  insert into public.content_events(content_post_id,event_type,detail) values(post.id,'model_publish_authorized',jsonb_build_object('review_id',item.id,'revision',item.revision,'ig_user_id',account.ig_user_id));
 else raise exception 'unknown action'; end if;
 insert into public.content_review_events(item_id,user_id,revision,action) values(item.id,p_user,item.revision,'publish_'||p_action);
 return jsonb_build_object('post_id',post.id);
end $$;
revoke all on function public.model_publish_command(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.model_publish_command(uuid,text,jsonb) to service_role;
