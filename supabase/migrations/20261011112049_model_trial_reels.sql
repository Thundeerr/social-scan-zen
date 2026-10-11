-- Trial Reels use manual graduation and are not announced to existing followers.
alter table public.content_posts add column publish_mode text not null default 'normal' check(publish_mode in ('normal','trial'));
create or replace function public.guard_model_post() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if old.destination<>'followerstar' then
  if current_user not in ('postgres','service_role') then raise exception 'Use the model review workflow'; end if;
  if TG_OP='UPDATE' and (new.publish_mode is distinct from old.publish_mode or new.target_ig_user_id is distinct from old.target_ig_user_id or new.caption is distinct from old.caption or new.media_sha256 is distinct from old.media_sha256 or new.reel_storage_path is distinct from old.reel_storage_path or new.user_id is distinct from old.user_id) then raise exception 'Prepared media, caption and target are immutable'; end if;
 end if;
 if TG_OP='DELETE' then return old; end if;
 return new;
end $$;
create or replace function public.model_publish_command(p_user uuid,p_action text,p_data jsonb) returns jsonb
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
  return jsonb_build_object('post_id',post.id,'status',post.status,'publish_mode',post.publish_mode,'username',account.ig_username,'ig_user_id',account.ig_user_id,
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
  if p_data->>'publish_mode' is null or p_data->>'publish_mode' not in ('normal','trial') then raise exception 'Choose publishing mode'; end if;
  if item.status<>'approved' or item.sha256 is null or length(btrim(item.caption))=0 then raise exception 'Approve video and caption first'; end if;
  if post.id is not null then return jsonb_build_object('post_id',post.id); end if;
  if account.id is null or account.status<>'active' or account.token_expires_at<=now()+interval '6 hours' then raise exception 'Connect this model to Instagram first'; end if;
  path:=p_user::text||'/model-review/'||item.id::text||'/'||item.sha256||'.mp4';
  if p_data->>'storage_path' is distinct from path or p_data->>'sha256' is distinct from item.sha256 then raise exception 'Media identity mismatch'; end if;
  insert into public.content_posts(user_id,post_key,title,caption,status,approved_at,approved_by,destination,target_ig_user_id,publish_mode,reel_storage_path,media_sha256,highlight_enabled,share_to_feed,story_publish_mode)
  values(p_user,'model-review-'||item.id::text,item.title,item.caption,'approved',item.reviewed_at,p_user,item.model,account.ig_user_id,p_data->>'publish_mode',path,item.sha256,false,true,'manual_link_sticker') returning * into post;
  insert into public.content_publications(content_post_id,channel) values(post.id,'reel');
  update public.content_review_items set publish_post_id=post.id where id=item.id;
  insert into public.content_events(content_post_id,event_type,detail) values(post.id,'model_review_prepared',jsonb_build_object('review_id',item.id,'revision',item.revision,'destination',item.model,'username',account.ig_username));
 elsif p_action='publish' then
  if post.id is null then raise exception 'Prepare publication first'; end if;
  if p_data->>'publish_mode' is distinct from post.publish_mode then raise exception 'Confirm the exact publishing mode'; end if;
  if p_data->>'confirmation' is distinct from 'PUBLISH' or p_data->>'ig_user_id' is distinct from post.target_ig_user_id then raise exception 'Confirm the exact Instagram destination'; end if;
  -- Repeated clicks return the existing job; failed/ambiguous jobs are not retried here.
  if post.status in ('scheduled','publishing','published') then return jsonb_build_object('post_id',post.id,'status',post.status); end if;
  if post.status<>'approved' or item.status<>'approved' or post.caption<>item.caption or post.media_sha256<>item.sha256 then raise exception 'Fresh review required'; end if;
  if account.id is null or account.ig_user_id<>post.target_ig_user_id or account.status<>'active' or account.token_expires_at<=now()+interval '6 hours' then raise exception 'Model connection is not ready'; end if;
  if not exists(select 1 from public.profiles where id=p_user and publishing_paused=false) then raise exception 'Cloud publishing is paused'; end if;
  update public.content_posts set status='scheduled',scheduled_for=now() where id=post.id;
  insert into public.content_events(content_post_id,event_type,detail) values(post.id,'model_publish_authorized',jsonb_build_object('review_id',item.id,'revision',item.revision,'ig_user_id',account.ig_user_id,'publish_mode',post.publish_mode));
 else raise exception 'unknown action'; end if;
 insert into public.content_review_events(item_id,user_id,revision,action) values(item.id,p_user,item.revision,'publish_'||p_action);
 return jsonb_build_object('post_id',post.id);
end $$;
revoke all on function public.model_publish_command(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.model_publish_command(uuid,text,jsonb) to service_role;

create or replace function public.model_alert_command(p_action text,p_user uuid default null,p_data jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  route public.model_alert_channels; job public.model_channel_alerts;
  today date := (now() at time zone 'Europe/Berlin')::date;
  account record;
begin
  if current_user not in ('service_role','postgres') then raise exception 'service only'; end if;
  if p_action in ('status','configure','check') then
    if p_user is null or not exists(select 1 from public.user_roles where user_id=p_user and role='owner') then raise exception 'owner only'; end if;
    if p_action='status' then
      return jsonb_build_object(
        'channels',(select jsonb_agg(to_jsonb(c)) from public.model_alert_channels c where user_id=p_user),
        'alerts',coalesce((select jsonb_agg(to_jsonb(a)-'lease' order by created_at desc) from
          (select * from public.model_channel_alerts where user_id=p_user order by created_at desc limit 30) a),'[]'),
        'connections',coalesce((select jsonb_agg(jsonb_build_object('id',id,'username',ig_username)) from public.ig_connections where user_id=p_user and status='active'),'[]'),
        'last_tick',(select last_tick from public.model_alert_worker_health where singleton));
    end if;
    select * into route from public.model_alert_channels where model=p_data->>'model' and user_id=p_user for update;
    if not found then raise exception 'unknown model'; end if;
    if p_action='check' then
      update public.model_alert_channels set bot_ready=(p_data->>'ready')::boolean,checked_at=now() where model=route.model;
    else
      if p_data ? 'connection_id' then
        if p_data->>'connection_id' is null then
          update public.model_alert_channels set ig_user_id=null,ig_username=null,enabled_since=now() where model=route.model;
        else
          select ig_user_id,ig_username into account from public.ig_connections where id=(p_data->>'connection_id')::uuid and user_id=p_user and status='active';
          if not found then raise exception 'own active account required'; end if;
          update public.model_alert_channels set ig_user_id=account.ig_user_id,ig_username=account.ig_username,enabled_since=now() where model=route.model;
        end if;
      end if;
      if p_data ? 'enabled' then
        update public.model_alert_channels set enabled=(p_data->>'enabled')::boolean,
          enabled_since=case when not enabled and (p_data->>'enabled')::boolean then now() else enabled_since end where model=route.model;
      end if;
    end if;
    return '{"ok":true}';
  end if;
  if p_user is not null then raise exception 'worker only'; end if;
  if p_action='claim' then
    update public.model_alert_worker_health set last_tick=now() where singleton;
    update public.model_channel_alerts set state='uncertain',error_code='send_result_unknown'
      where state='sending' and lease_until<now();
    update public.model_channel_alerts set state='sent',retry_at=now(),lease=null
      where state='deleting' and lease_until<now();
    update public.model_channel_alerts set state='delete_failed',error_code='delete_window_expired'
      where state='sent' and sent_at<now()-interval '47 hours';
    -- Deletions remain active even if announcements are disabled or the mapping changes.
    select * into job from public.model_channel_alerts
      where state='sent' and delete_after<=now() and (retry_at is null or retry_at<=now())
      order by delete_after for update skip locked limit 1;
    if found then
      update public.model_channel_alerts set state='deleting',lease=gen_random_uuid(),lease_until=now()+interval '3 minutes',
        delete_attempts=delete_attempts+1 where id=job.id returning * into job;
      return to_jsonb(job);
    end if;
    if not coalesce((p_data->>'allow_send')::boolean,false) then return null; end if;
    -- No backfill, no unapproved/failed posts, no stories/comments or source-account guesses.
    insert into public.model_channel_alerts(publication_id,model,user_id,chat_id,permalink)
      select pub.id,c.model,c.user_id,c.chat_id,pub.permalink
      from public.content_publications pub join public.content_posts p on p.id=pub.content_post_id
      join public.model_alert_channels c on c.user_id=p.user_id and c.ig_user_id=pub.published_ig_user_id
      where c.enabled and c.bot_ready and p.status='published' and p.approved_at is not null and p.publish_mode='normal'
        and pub.status='published' and pub.channel in ('reel','feed') and pub.platform_media_id is not null
        and pub.published_at>=c.enabled_since and pub.published_at<=now() and pub.published_at>now()-interval '2 hours'
        and pub.permalink ~ '^https://www\.instagram\.com/(reel|p)/[A-Za-z0-9_-]+/$'
      on conflict(publication_id) do nothing;
    for route in select * from public.model_alert_channels where enabled and bot_ready and ig_user_id is not null order by model for update skip locked loop
      update public.model_channel_alerts a set state='skipped',error_code='no_longer_eligible'
        where a.model=route.model and a.state='pending' and not exists(
          select 1 from public.content_publications pub join public.content_posts p on p.id=pub.content_post_id
          where pub.id=a.publication_id and pub.published_ig_user_id=route.ig_user_id and p.status='published'
            and p.approved_at is not null and p.publish_mode='normal' and pub.status='published' and pub.published_at>=route.enabled_since
            and pub.published_at>now()-interval '2 hours');
      if exists(select 1 from public.model_channel_alerts where chat_id=route.chat_id and send_day=today) then
        update public.model_channel_alerts set state='skipped',error_code='daily_limit' where model=route.model and state='pending';
        continue;
      end if;
      select * into job from public.model_channel_alerts where model=route.model and state='pending' order by created_at,id for update skip locked limit 1;
      if found then
        update public.model_channel_alerts set state='sending',send_day=today,lease=gen_random_uuid(),lease_until=now()+interval '3 minutes'
          where id=job.id returning * into job;
        return to_jsonb(job);
      end if;
    end loop;
    return null;
  elsif p_action in ('sent','deleted','delete_retry','uncertain') then
    select * into job from public.model_channel_alerts where id=(p_data->>'id')::uuid and lease=(p_data->>'lease')::uuid for update;
    if not found then raise exception 'stale lease'; end if;
    if p_action='sent' and job.state in ('sending','uncertain') then
      update public.model_channel_alerts set state='sent',message_id=(p_data->>'message_id')::bigint,
        sent_at=to_timestamp((p_data->>'date')::double precision),
        delete_after=to_timestamp((p_data->>'date')::double precision)+interval '12 hours',
        lease=null,lease_until=null,error_code=null where id=job.id;
    elsif p_action='uncertain' and job.state='sending' then
      update public.model_channel_alerts set state='uncertain',error_code='send_result_unknown' where id=job.id;
    elsif p_action='deleted' and job.state='deleting' then
      update public.model_channel_alerts set state='deleted',lease=null,lease_until=null,error_code=null where id=job.id;
    elsif p_action='delete_retry' and job.state='deleting' then
      update public.model_channel_alerts set state='sent',lease=null,lease_until=null,retry_at=now()+interval '5 minutes',error_code='delete_retry' where id=job.id;
    else raise exception 'invalid transition'; end if;
    return '{"ok":true}';
  end if;
  raise exception 'unknown action';
end $$;
revoke all on function public.model_alert_command(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.model_alert_command(text,uuid,jsonb) to service_role;


