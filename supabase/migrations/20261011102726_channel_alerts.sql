-- Capture the account actually used by the publisher, never infer it later.
alter table public.content_publications add column published_ig_user_id text;

create table public.model_alert_channels (
  model text primary key check(model in ('kiikii','tuuva')),
  user_id uuid not null references auth.users(id),
  chat_id text not null unique check(chat_id ~ '^-[0-9]+$'),
  ig_user_id text unique,
  ig_username text,
  enabled boolean not null default true,
  enabled_since timestamptz not null default now(),
  bot_ready boolean not null default false,
  checked_at timestamptz
);
create table public.model_channel_alerts (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid not null unique references public.content_publications(id),
  model text not null references public.model_alert_channels(model),
  user_id uuid not null references auth.users(id),
  chat_id text not null,
  permalink text not null check(permalink ~ '^https://www\.instagram\.com/(reel|p)/[A-Za-z0-9_-]+/$'),
  state text not null default 'pending' check(state in ('pending','sending','sent','uncertain','skipped','deleting','deleted','delete_failed')),
  send_day date,
  lease uuid,
  lease_until timestamptz,
  message_id bigint check(message_id > 0),
  sent_at timestamptz,
  delete_after timestamptz,
  retry_at timestamptz,
  delete_attempts integer not null default 0,
  error_code text,
  created_at timestamptz not null default now(),
  unique(chat_id,send_day)
);
create index model_channel_alert_due on public.model_channel_alerts(state,delete_after,retry_at);
create table public.model_alert_worker_health (
  singleton boolean primary key default true check(singleton),
  last_tick timestamptz
);
insert into public.model_alert_worker_health(singleton) values(true);
alter table public.model_alert_channels enable row level security;
alter table public.model_channel_alerts enable row level security;
alter table public.model_alert_worker_health enable row level security;
revoke all on public.model_alert_channels,public.model_channel_alerts,public.model_alert_worker_health from public,anon,authenticated;
grant all on public.model_alert_channels,public.model_channel_alerts,public.model_alert_worker_health to service_role;
grant select on public.model_alert_channels,public.model_channel_alerts to authenticated;
create policy own_alert_channels on public.model_alert_channels for select to authenticated using(user_id=(select auth.uid()));
create policy own_channel_alerts on public.model_channel_alerts for select to authenticated using(user_id=(select auth.uid()));
insert into public.model_alert_channels(model,user_id,chat_id) values
 ('kiikii','e4ee414f-fbb6-4f82-b5fc-22d74ed6b3cc','-1003904760564'),
 ('tuuva','e4ee414f-fbb6-4f82-b5fc-22d74ed6b3cc','-1003979039770');

create function public.model_alert_command(p_action text,p_user uuid default null,p_data jsonb default '{}')
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
      where c.enabled and c.bot_ready and p.status='published' and p.approved_at is not null
        and pub.status='published' and pub.channel in ('reel','feed') and pub.platform_media_id is not null
        and pub.published_at>=c.enabled_since and pub.published_at<=now() and pub.published_at>now()-interval '2 hours'
        and pub.permalink ~ '^https://www\.instagram\.com/(reel|p)/[A-Za-z0-9_-]+/$'
      on conflict(publication_id) do nothing;
    for route in select * from public.model_alert_channels where enabled and bot_ready and ig_user_id is not null order by model for update skip locked loop
      update public.model_channel_alerts a set state='skipped',error_code='no_longer_eligible'
        where a.model=route.model and a.state='pending' and not exists(
          select 1 from public.content_publications pub join public.content_posts p on p.id=pub.content_post_id
          where pub.id=a.publication_id and pub.published_ig_user_id=route.ig_user_id and p.status='published'
            and p.approved_at is not null and pub.status='published' and pub.published_at>=route.enabled_since
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

-- Only the dedicated worker is invoked; existing posting/scanner jobs are unchanged.
select cron.schedule('model-channel-alerts-every-minute','* * * * *',$cron$
  select net.http_post(
    url := 'https://instascanner.app/api/channel-alerts/tick',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',
      (select decrypted_secret from vault.decrypted_secrets where name='CRON_SECRET' limit 1)),
    body := '{}'::jsonb, timeout_milliseconds := 60000);
$cron$);
