-- Server-fetch comment campaigns: no credentials enter pg_net or client roles.
alter table public.ig_dm_redirect_receipts
  add column campaign_media_id text check(campaign_media_id ~ '^[0-9]{1,40}$'),
  add column comment_id text check(comment_id ~ '^[0-9]{1,40}$');
create unique index ig_comment_campaign_one_attempt
  on public.ig_dm_redirect_receipts(user_id,campaign_media_id,sender_id)
  where source='comment' and campaign_media_id is not null
    and status in ('reserved','sent','failed','uncertain');

create table public.ig_comment_campaigns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.ig_dm_redirect_settings(user_id),
  content_post_id uuid not null references public.content_posts(id),
  media_id text not null check(media_id ~ '^[0-9]{1,40}$'),
  trigger_text text not null default '<3' check(trigger_text='<3'),
  reply_text text not null check(length(btrim(reply_text)) between 1 and 1000),
  starts_at timestamptz not null,
  enabled boolean not null default false,
  activated_at timestamptz,
  last_webhook_at timestamptz,
  last_verified_comment_at timestamptz,
  last_delivery_at timestamptz,
  last_error_code text,
  last_error_at timestamptz,
  backfill_cursor text check(length(backfill_cursor)<=4096),
  backfill_cursor_hashes text[] not null default '{}',
  backfill_revision integer not null default 0,
  backfill_complete_at timestamptz,
  last_catchup_at timestamptz,
  created_at timestamptz not null default now(),
  unique(user_id,media_id)
);
alter table public.ig_comment_campaigns enable row level security;
revoke all on public.ig_comment_campaigns from public,anon,authenticated;
grant all on public.ig_comment_campaigns to service_role;

create function public.ig_comment_campaign_reserve(
  p_receiver text,p_media text,p_sender text,p_comment text,p_event_at timestamptz,p_username text,p_text text
) returns jsonb language plpgsql security invoker set search_path=public,pg_catalog as $$
declare dm public.ig_dm_redirect_settings; campaign public.ig_comment_campaigns;
  person public.ig_dm_redirect_contacts; v_hash text; outcome text;
begin
  -- Same first lock as the older responders; commits before the server's POST.
  select * into dm from public.ig_dm_redirect_settings where receiver_id=p_receiver and mode='off' for update;
  if not found then return '{"ignored":true}'; end if;
  select * into campaign from public.ig_comment_campaigns
    where user_id=dm.user_id and media_id=p_media and enabled for update;
  if not found then return '{"ignored":true}'; end if;
  if not exists(select 1 from public.user_roles where user_id=dm.user_id and role in ('owner','cofounder')) then return '{"ignored":true}'; end if;
  if not exists(select 1 from public.content_posts p join public.content_publications v on v.content_post_id=p.id
    where p.id=campaign.content_post_id and p.user_id=dm.user_id and p.destination='kiikii' and p.status='published'
      and v.channel='reel' and v.status='published' and v.platform_media_id=campaign.media_id and v.published_ig_user_id=p_receiver) then return '{"ignored":true}'; end if;
  if p_sender is null or p_sender !~ '^[0-9]{1,40}$' or p_sender=p_receiver
    or p_comment is null or p_comment !~ '^[0-9]{1,40}$' or lower(coalesce(p_username,''))='kiikii.bat'
    or btrim(p_text) is distinct from campaign.trigger_text then return '{"ignored":true}'; end if;
  if p_event_at is null or p_event_at<campaign.starts_at or p_event_at<now()-interval '7 days'
    or p_event_at>now()+interval '5 minutes' then return '{"ignored":true}'; end if;
  v_hash:=encode(sha256(convert_to('comment:'||p_comment,'UTF8')),'hex');
  if exists(select 1 from public.ig_dm_redirect_receipts r where r.user_id=dm.user_id
    and (r.message_hash=v_hash or (r.campaign_media_id=p_media and r.sender_id=p_sender
      and r.status in ('reserved','sent','failed','uncertain')))) then return '{"duplicate":true}'; end if;
  insert into public.ig_dm_redirect_contacts(user_id,sender_id) values(dm.user_id,p_sender) on conflict do nothing;
  select * into person from public.ig_dm_redirect_contacts where user_id=dm.user_id and sender_id=p_sender for update;
  outcome:=case when person.opted_out then 'opted_out'
    when person.last_attempt_at>now()-interval '24 hours' then 'cooldown' else 'reserved' end;
  insert into public.ig_dm_redirect_receipts(user_id,message_hash,sender_id,event_at,variant,status,source,campaign_media_id,comment_id)
    values(dm.user_id,v_hash,p_sender,p_event_at,null,outcome,'comment',p_media,p_comment);
  if outcome='reserved' then
    update public.ig_dm_redirect_contacts set last_attempt_at=now() where user_id=dm.user_id and sender_id=p_sender;
  end if;
  update public.ig_comment_campaigns set last_verified_comment_at=now() where id=campaign.id;
  return jsonb_build_object('send',outcome='reserved','user_id',dm.user_id,'campaign_id',campaign.id,
    'message_hash',v_hash,'reply_text',case when outcome='reserved' then campaign.reply_text else null end);
end $$;
revoke all on function public.ig_comment_campaign_reserve(text,text,text,text,timestamptz,text,text) from public,anon,authenticated;
grant execute on function public.ig_comment_campaign_reserve(text,text,text,text,timestamptz,text,text) to service_role;

-- Preserve the real successful test's per-person dedupe before enabling anything.
do $$
declare seeded integer;
begin
if exists(select 1 from public.content_posts where id='9c7203d1-3d4a-4d85-881b-613ac5fa042f'
  and user_id='e4ee414f-fbb6-4f82-b5fc-22d74ed6b3cc' and destination='kiikii' and status='published') then
update public.ig_dm_redirect_receipts set campaign_media_id='18196729870394207',comment_id='18473482705191162'
  where user_id='e4ee414f-fbb6-4f82-b5fc-22d74ed6b3cc' and sender_id='1569413477836896'
    and source='comment' and status='sent' and provider_message_id is not null
    and message_hash=encode(sha256(convert_to('comment:18473482705191162','UTF8')),'hex');
get diagnostics seeded=row_count;
if seeded<>1 then raise exception 'The successful Kiikii test receipt must be verified before campaign setup'; end if;

-- Prepared, not enabled. Activation follows deployed-webhook and subscription checks.
insert into public.ig_comment_campaigns(user_id,content_post_id,media_id,reply_text,starts_at)
  select p.user_id,p.id,'18196729870394207','heyy, you wanted a closer look? 👀 say hi here 💚',p.published_at
  from public.content_posts p
  where p.id='9c7203d1-3d4a-4d85-881b-613ac5fa042f' and p.user_id='e4ee414f-fbb6-4f82-b5fc-22d74ed6b3cc'
    and p.destination='kiikii' and p.status='published' and p.published_at is not null
    and exists(select 1 from public.content_publications v where v.content_post_id=p.id and v.channel='reel'
      and v.status='published' and v.platform_media_id='18196729870394207' and v.published_ig_user_id='17841416918437774');
get diagnostics seeded=row_count;
if seeded<>1 then raise exception 'The exact published Kiikii reel must be verified before campaign setup'; end if;
end if;
end $$;
