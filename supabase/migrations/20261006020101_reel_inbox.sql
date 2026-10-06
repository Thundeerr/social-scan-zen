-- Additive and independent of content_posts / Instagram publishing.
create table public.reel_inbox_devices (
  user_id uuid primary key references auth.users(id),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  instance_id uuid,
  revoked boolean not null default false,
  expires_at timestamptz not null default now() + interval '180 days',
  last_seen_at timestamptz
);
create table public.reel_inbox_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  shortcode text not null check (shortcode ~ '^[A-Za-z0-9_-]{5,64}$'),
  canonical_url text not null,
  status text not null default 'queued' check (status in ('queued','working','ready','failed')),
  desired_stage text not null default 'Neu' check (desired_stage in ('Neu','In Arbeit','Verwendet')),
  confirmed_stage text check (confirmed_stage in ('Neu','In Arbeit','Verwendet')),
  is_test boolean not null default false,
  receipt jsonb,
  error_code text,
  lease_id uuid,
  lease_until timestamptz,
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default now(),
  unique(user_id, shortcode),
  check (canonical_url = 'https://www.instagram.com/reel/' || shortcode || '/' or canonical_url = 'https://www.instagram.com/p/' || shortcode || '/')
);
create index reel_inbox_pending on public.reel_inbox_items(user_id, status, created_at);
alter table public.reel_inbox_devices enable row level security;
alter table public.reel_inbox_items enable row level security;
revoke all on public.reel_inbox_devices, public.reel_inbox_items from public, anon, authenticated;
grant all on public.reel_inbox_devices, public.reel_inbox_items to service_role;
grant select on public.reel_inbox_items to authenticated;
create policy reel_inbox_own_read on public.reel_inbox_items for select to authenticated using (user_id = (select auth.uid()));

-- Invoker: no privilege elevation. Only the trusted server can execute this.
-- All commands are one database transaction; no web client can forge receipts.
create function public.reel_inbox_command(p_action text, p_user uuid, p_payload jsonb, p_device_hash text default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  actor uuid; item public.reel_inbox_items; device public.reel_inbox_devices;
  link jsonb; results jsonb := '[]'; duplicate boolean; stage text;
begin
  if current_user not in ('service_role', 'postgres') then raise exception 'unauthorized'; end if;
  if p_device_hash is not null then
    select * into device from public.reel_inbox_devices where token_hash = p_device_hash and not revoked and expires_at > now() for update;
    if not found then raise exception 'unauthorized device'; end if;
    actor := device.user_id;
    if p_action not in ('claim','renew','ack','fail') then raise exception 'device scope'; end if;
    if p_action = 'claim' then
      if p_payload->>'instance' is null then raise exception 'instance required'; end if;
      if device.instance_id is not null and device.instance_id <> (p_payload->>'instance')::uuid then raise exception 'device already bound'; end if;
      update public.reel_inbox_devices set instance_id = (p_payload->>'instance')::uuid where user_id=actor;
    end if;
    update public.reel_inbox_devices set last_seen_at=now() where user_id=actor;
  else
    actor := p_user;
    if actor is null or not exists(select 1 from public.user_roles where user_id=actor and role in ('owner','cofounder')) then raise exception 'operator required'; end if;
    if p_action not in ('list','submit','move','retry','pair','revoke') then raise exception 'operator scope'; end if;
  end if;
  if p_action='list' then
    return jsonb_build_object('items', coalesce((select jsonb_agg(to_jsonb(i) - 'lease_id' - 'lease_until' - 'user_id' order by i.created_at desc) from (select * from public.reel_inbox_items where user_id=actor and (p_payload->>'before' is null or created_at < (p_payload->>'before')::timestamptz) order by created_at desc limit 100) i),'[]'::jsonb),
      'device',(select jsonb_build_object('last_seen_at',last_seen_at,'revoked',revoked or expires_at <= now()) from public.reel_inbox_devices where user_id=actor));
  elsif p_action='pair' then
    insert into public.reel_inbox_devices(user_id,token_hash) values(actor,p_payload->>'hash')
    on conflict(user_id) do update set token_hash=excluded.token_hash, instance_id=null, revoked=false, expires_at=now()+interval '180 days',last_seen_at=null;
    return '{"ok":true}';
  elsif p_action='revoke' then
    update public.reel_inbox_devices set revoked=true where user_id=actor;
    return '{"ok":true}';
  elsif p_action='submit' then
    if jsonb_array_length(p_payload->'links') > 50 then raise exception 'too many'; end if;
    -- Serialize submissions for one operator (including their first submission).
    perform pg_advisory_xact_lock(hashtextextended(actor::text, 0));
    if (select count(*) from public.reel_inbox_items where user_id=actor) >= 10000 then raise exception 'inbox limit'; end if;
    for link in select * from jsonb_array_elements(p_payload->'links') loop
      insert into public.reel_inbox_items(user_id,shortcode,canonical_url,is_test)
      values(actor,link->>'shortcode',link->>'url',coalesce((p_payload->>'test')::boolean,false))
      on conflict(user_id,shortcode) do nothing returning * into item;
      duplicate := not found;
      if duplicate then select * into item from public.reel_inbox_items where user_id=actor and shortcode=link->>'shortcode'; end if;
      results := results || jsonb_build_array(jsonb_build_object('id',item.id,'duplicate',duplicate));
    end loop;
    return results;
  elsif p_action in ('move','retry') then
    select * into item from public.reel_inbox_items where id=(p_payload->>'id')::uuid and user_id=actor for update;
    if not found then raise exception 'not found'; end if;
    if p_action='move' then
      stage:=p_payload->>'stage';
      if item.status <> 'ready' or stage not in ('Neu','In Arbeit','Verwendet') or stage is null then raise exception 'not ready'; end if;
      update public.reel_inbox_items set desired_stage=stage,status=case when confirmed_stage=stage then 'ready' else 'queued' end,error_code=null,updated_at=now() where id=item.id;
    else
      if item.status <> 'failed' then raise exception 'not failed'; end if;
      update public.reel_inbox_items set status='queued',error_code=null,attempts=0,available_at=now(),updated_at=now() where id=item.id;
    end if;
    return '{"ok":true}';
  elsif p_action='claim' then
    select * into item from public.reel_inbox_items where user_id=actor and ((status='queued' and available_at <= now()) or (status='working' and lease_until < now())) order by created_at for update skip locked limit 1;
    if not found then return 'null'; end if;
    update public.reel_inbox_items set status='working',lease_id=gen_random_uuid(),lease_until=now()+interval '5 minutes',attempts=attempts+1,updated_at=now() where id=item.id returning * into item;
    return to_jsonb(item) - 'user_id';
  else
    select * into item from public.reel_inbox_items where id=(p_payload->>'id')::uuid and user_id=actor for update;
    if not found or item.lease_id is distinct from (p_payload->>'lease')::uuid then raise exception 'stale lease'; end if;
    if p_action='ack' and item.status='ready' then return '{"ok":true}'; end if;
    if item.status <> 'working' or item.lease_until < now() then raise exception 'expired lease'; end if;
    if p_action='renew' then
      update public.reel_inbox_items set lease_until=now()+interval '5 minutes' where id=item.id;
    elsif p_action='fail' then
      if p_payload->>'code' not in ('unavailable','unsupported','interrupted','validation','path_blocked','disk_error','conflict','setup') then raise exception 'invalid failure'; end if;
      update public.reel_inbox_items set status=case when p_payload->>'code'='interrupted' and attempts < 5 then 'queued' else 'failed' end,error_code=p_payload->>'code',lease_until=null,available_at=now()+make_interval(secs=>least(900,30*power(2,least(attempts,5)))::integer),updated_at=now() where id=item.id;
    elsif p_action='ack' then
      if p_payload->'receipt'->>'stage' is distinct from item.desired_stage or
         p_payload->'receipt'->>'folder' is distinct from item.desired_stage || '/' || item.shortcode || '_' || item.id::text or
         coalesce(p_payload->'receipt'->>'sha256','') !~ '^[a-f0-9]{64}$' or
         coalesce((p_payload->'receipt'->>'bytes')::bigint,0) not between 1 and 536870912 then raise exception 'invalid receipt'; end if;
      update public.reel_inbox_items set status='ready',confirmed_stage=desired_stage,receipt=p_payload->'receipt',error_code=null,lease_until=null,updated_at=now() where id=item.id;
    end if;
    return '{"ok":true}';
  end if;
end $$;
revoke all on function public.reel_inbox_command(text,uuid,jsonb,text) from public, anon, authenticated;
grant execute on function public.reel_inbox_command(text,uuid,jsonb,text) to service_role;
