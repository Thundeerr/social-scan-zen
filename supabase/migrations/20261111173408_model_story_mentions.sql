-- Opt-in only. Applying this migration neither schedules nor publishes a post.
alter table public.model_posting_policies
  add column story_enabled boolean not null default false,
  add column story_source_ig_user_id text,
  add column story_mention_username text,
  add column story_template_storage_paths text[] not null default '{}',
  add column story_template_next_index integer not null default 0 check(story_template_next_index>=0),
  add constraint model_story_policy_valid check (
    (story_source_ig_user_id is null or story_source_ig_user_id ~ '^[0-9]+$')
    and (story_mention_username is null or story_mention_username ~ '^[A-Za-z0-9._]{1,30}$')
    and cardinality(story_template_storage_paths) between 0 and 100
    and (cardinality(story_template_storage_paths)=0 or
      (array_ndims(story_template_storage_paths)=1 and array_lower(story_template_storage_paths,1)=1))
    and array_position(story_template_storage_paths,null) is null
    and (not story_enabled or (story_source_ig_user_id is not null and story_mention_username is not null
      and cardinality(story_template_storage_paths)>0))
  );

create function public.validate_model_story_templates() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if exists(select 1 from unnest(new.story_template_storage_paths) path
      where nullif(btrim(path),'') is null or left(path,length(new.user_id::text)+1)<>new.user_id::text||'/')
    or (select count(distinct path) from unnest(new.story_template_storage_paths) path)<>cardinality(new.story_template_storage_paths)
    then raise exception 'Story templates must be distinct nonempty paths owned by this user'; end if;
  return new;
end $$;
revoke all on function public.validate_model_story_templates() from public,anon,authenticated;
create trigger model_story_templates_valid before insert or update on public.model_posting_policies
  for each row execute function public.validate_model_story_templates();

alter table public.content_posts
  add column story_mention_username text,
  add column story_media_type text check(story_media_type in ('image','video')),
  add column story_media_reusable boolean not null default false,
  add column story_link_delay_seconds integer check(story_link_delay_seconds between 300 and 1200),
  add column story_link_not_before timestamptz,
  add constraint content_story_due_valid check(story_link_not_before is null or
    (story_link_delay_seconds is not null and isfinite(story_link_not_before))),
  add constraint content_reusable_story_valid check (
    not story_media_reusable or (story_media_type is not null and story_media_type='image'
      and nullif(btrim(story_storage_path),'') is not null)
  ),
  add constraint content_story_mention_valid check (
    story_mention_username is null or (
      story_mention_username ~ '^[A-Za-z0-9._]{1,30}$'
      and story_publish_mode='automatic_no_link'
      and nullif(btrim(story_storage_path),'') is not null
    )
  );

-- Snapshot the opt-in policy into a prepared post. Later policy edits cannot
-- silently retarget an approved/scheduled Story. Repeated calls are idempotent.
create function public.configure_model_post_story(p_post_id uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
declare post public.content_posts; policy public.model_posting_policies; template_index integer; template_path text; delay_seconds integer;
begin
  if current_user not in ('postgres','service_role') then raise exception 'Service role required'; end if;
  select * into post from public.content_posts where id=p_post_id for update;
  if not found then raise exception 'Content post not found'; end if;
  select * into policy from public.model_posting_policies
    where user_id=post.user_id and model=post.destination for update;
  if not found or not policy.story_enabled or post.destination='followerstar'
    or post.publish_mode<>'normal' or post.content_type<>'reel'
    or post.target_ig_user_id is distinct from policy.story_source_ig_user_id then return false; end if;
  if post.story_mention_username=policy.story_mention_username
    and post.story_publish_mode='automatic_no_link'
    and post.story_storage_path is not null
    and post.story_media_type='image' and post.story_media_reusable
    and post.story_link_delay_seconds is not null
    and exists(select 1 from public.content_publications where content_post_id=post.id and channel='story')
    then return true; end if;
  if post.status not in ('approved','scheduled') or post.publish_lease_token is not null
    or exists(select 1 from public.content_publications where content_post_id=post.id
      and (status<>'pending' or attempts<>0 or platform_media_id is not null
        or platform_container_id is not null or external_action_started_at is not null or recovery_required))
    then raise exception 'Story setup requires an untouched prepared post'; end if;
  if nullif(btrim(post.reel_storage_path),'') is null then raise exception 'Approved Reel media missing'; end if;
  if post.story_mention_username is not null or post.story_storage_path is not null
    or exists(select 1 from public.content_publications where content_post_id=post.id and channel in ('story','story_handoff'))
    then raise exception 'Existing Story setup must be reviewed explicitly'; end if;
  template_index:=policy.story_template_next_index % cardinality(policy.story_template_storage_paths);
  template_path:=policy.story_template_storage_paths[template_index+1];
  update public.content_posts set story_publish_mode='automatic_no_link',
    story_storage_path=template_path,story_mention_username=policy.story_mention_username,
    story_media_type='image',story_media_reusable=true,
    story_link_delay_seconds=300+floor(random()*901)::integer
    where id=post.id returning story_link_delay_seconds into delay_seconds;
  insert into public.content_publications(content_post_id,channel) values(post.id,'story');
  update public.model_posting_policies set
    story_template_next_index=(template_index+1) % cardinality(policy.story_template_storage_paths)
    where user_id=post.user_id and model=post.destination;
  insert into public.content_events(content_post_id,event_type,detail)
    values(post.id,'model_story_prepared',jsonb_build_object('mention_username',policy.story_mention_username,
      'source_ig_user_id',policy.story_source_ig_user_id,'media_source','approved_static_template',
      'template_index',template_index,'template_pool_size',cardinality(policy.story_template_storage_paths),
      'link_delay_seconds',delay_seconds));
  return true;
end $$;
revoke all on function public.configure_model_post_story(uuid) from public,anon,authenticated;
grant execute on function public.configure_model_post_story(uuid) to service_role;

create function public.prepare_model_post_story() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if new.destination in ('kiikii','tuuva') and new.status='approved' then
    perform public.configure_model_post_story(new.id);
  end if;
  return new;
end $$;
revoke all on function public.prepare_model_post_story() from public,anon,authenticated;
create trigger model_post_story_prepare after insert on public.content_posts
  for each row execute function public.prepare_model_post_story();

create function public.guard_model_post_story() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if (new.story_mention_username is not null or old.story_mention_username is not null
    or new.story_media_reusable or old.story_media_reusable)
    and (new.story_mention_username is distinct from old.story_mention_username
      or new.story_storage_path is distinct from old.story_storage_path
      or new.story_publish_mode is distinct from old.story_publish_mode
      or new.story_media_type is distinct from old.story_media_type
      or new.story_media_reusable is distinct from old.story_media_reusable) then
    if current_user not in ('postgres','service_role') then raise exception 'Service role required'; end if;
    if old.status not in ('approved','scheduled') or old.publish_lease_token is not null
      or exists(select 1 from public.content_publications where content_post_id=old.id
        and (status<>'pending' or attempts<>0 or platform_media_id is not null
          or platform_container_id is not null or external_action_started_at is not null or recovery_required))
      then raise exception 'Started Story setup is immutable'; end if;
  end if;
  return new;
end $$;
revoke all on function public.guard_model_post_story() from public,anon,authenticated;
create trigger model_post_story_guard before update of story_mention_username,story_storage_path,story_publish_mode,story_media_type,story_media_reusable
  on public.content_posts for each row execute function public.guard_model_post_story();

-- A prepared delay is chosen once. The absolute due time is filled only after a
-- real primary receipt exists, and remains stable across retries/metadata edits.
create function public.guard_model_story_time() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if new.story_link_delay_seconds is distinct from old.story_link_delay_seconds
    or new.story_link_not_before is distinct from old.story_link_not_before then
    if current_user not in ('postgres','service_role') then raise exception 'Service role required'; end if;
    if old.story_link_delay_seconds is not null and new.story_link_delay_seconds is distinct from old.story_link_delay_seconds
      then raise exception 'Story delay snapshot is immutable'; end if;
    if old.story_link_not_before is not null and new.story_link_not_before is distinct from old.story_link_not_before
      then raise exception 'Story due time snapshot is immutable'; end if;
  end if;
  return new;
end $$;
revoke all on function public.guard_model_story_time() from public,anon,authenticated;
create trigger model_story_time_guard before update of story_link_delay_seconds,story_link_not_before
  on public.content_posts for each row execute function public.guard_model_story_time();

create function public.ensure_model_story_time(p_post_id uuid,p_lease_token uuid) returns timestamptz
language plpgsql security invoker set search_path='' as $$
declare post public.content_posts; reel public.content_publications; due_at timestamptz;
begin
  if current_user not in ('postgres','service_role') then raise exception 'Service role required'; end if;
  select * into post from public.content_posts where id=p_post_id for update;
  if not found or p_lease_token is null or post.publish_lease_token is distinct from p_lease_token
    or post.publish_lease_until is null or post.publish_lease_until<=clock_timestamp()
    or post.status<>'publishing'
    or not exists(select 1 from public.profiles where id=post.user_id and publishing_paused=false)
    then raise exception 'Live publisher lease required for Story timing'; end if;
  if post.destination not in ('kiikii','tuuva') or post.publish_mode<>'normal' or post.content_type<>'reel'
    or post.story_publish_mode<>'automatic_no_link' or post.story_mention_username is null
    or post.story_media_type is distinct from 'image' or not post.story_media_reusable
    or post.story_link_delay_seconds is null then raise exception 'Prepared model Story timing required'; end if;
  select * into reel from public.content_publications where content_post_id=post.id and channel='reel';
  if not found or reel.status<>'published' or reel.platform_media_id is null
    or reel.recovery_required or reel.published_at is null or not isfinite(reel.published_at)
    then raise exception 'Confirmed primary Reel receipt and timestamp required for Story timing'; end if;
  if post.story_link_not_before is not null then return post.story_link_not_before; end if;
  due_at:=reel.published_at+make_interval(secs=>post.story_link_delay_seconds);
  update public.content_posts set story_link_not_before=due_at where id=post.id;
  insert into public.content_events(content_post_id,event_type,detail)
    values(post.id,'model_story_delay_anchored',jsonb_build_object('primary_media_id',reel.platform_media_id,
      'primary_published_at',reel.published_at,'delay_seconds',post.story_link_delay_seconds,'not_before',due_at));
  return due_at;
end $$;
revoke all on function public.ensure_model_story_time(uuid,uuid) from public,anon,authenticated;
grant execute on function public.ensure_model_story_time(uuid,uuid) to service_role;
