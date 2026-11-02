-- Private, server-only state. No message bodies or access tokens are copied here.
alter table public.ig_oauth_states add column requested_scopes text[];
alter table public.ig_oauth_states add column dm_redirect boolean not null default false;

create table public.ig_dm_redirect_settings (
  user_id uuid primary key references auth.users(id),
  receiver_id text not null unique check(receiver_id = '17841416918437774'),
  mode text not null default 'off' check(mode in ('off','test','live')),
  test_username text not null default 'user_diary01',
  activated_at timestamptz,
  last_received_at timestamptz
);
create table public.ig_dm_redirect_contacts (
  user_id uuid not null references public.ig_dm_redirect_settings(user_id),
  sender_id text not null check(sender_id ~ '^[0-9]{1,40}$'),
  opted_out boolean not null default false,
  last_attempt_at timestamptz,
  previous_variant integer check(previous_variant between 0 and 29),
  primary key(user_id,sender_id)
);
create table public.ig_dm_redirect_receipts (
  user_id uuid not null references public.ig_dm_redirect_settings(user_id),
  message_hash text not null check(message_hash ~ '^[a-f0-9]{64}$'),
  sender_id text not null,
  received_at timestamptz not null default now(),
  event_at timestamptz not null,
  variant integer check(variant between 0 and 29),
  status text not null check(status in ('reserved','sent','failed','uncertain','cooldown','opted_out')),
  provider_message_id text,
  error_code text,
  finished_at timestamptz,
  primary key(user_id,message_hash)
);
create index ig_dm_redirect_recent on public.ig_dm_redirect_receipts(user_id,received_at desc);
alter table public.ig_dm_redirect_settings enable row level security;
alter table public.ig_dm_redirect_contacts enable row level security;
alter table public.ig_dm_redirect_receipts enable row level security;
revoke all on public.ig_dm_redirect_settings,public.ig_dm_redirect_contacts,public.ig_dm_redirect_receipts from public,anon,authenticated;
grant all on public.ig_dm_redirect_settings,public.ig_dm_redirect_contacts,public.ig_dm_redirect_receipts to service_role;

-- A committed reservation is NEVER automatically retried. Meta's send endpoint
-- offers no idempotency guarantee: a timeout may already have delivered the DM.
create function public.ig_dm_redirect_reserve(
  p_receiver text,p_sender text,p_hash text,p_event_at timestamptz,p_stop boolean,p_username text
) returns jsonb language plpgsql security invoker set search_path=public as $$
declare cfg public.ig_dm_redirect_settings; person public.ig_dm_redirect_contacts;
  chosen integer; outcome text;
begin
  select * into cfg from public.ig_dm_redirect_settings where receiver_id=p_receiver and mode<>'off' for update;
  if not found then return '{"ignored":true}'; end if;
  if not exists(select 1 from public.user_roles where user_id=cfg.user_id and role in ('owner','cofounder')) then return '{"ignored":true}'; end if;
  if p_sender is null or p_sender !~ '^[0-9]{1,40}$' or p_sender=p_receiver or p_hash is null or p_hash !~ '^[a-f0-9]{64}$' or p_stop is null then raise exception 'invalid event'; end if;
  if p_event_at is null or p_event_at < now()-interval '23 hours 59 minutes' or p_event_at > now()+interval '5 minutes' or cfg.activated_at is null or p_event_at < cfg.activated_at-interval '5 seconds' then return '{"ignored":true}'; end if;
  if cfg.mode='test' and lower(coalesce(p_username,''))<>cfg.test_username then return '{"ignored":true}'; end if;
  if exists(select 1 from public.ig_dm_redirect_receipts where user_id=cfg.user_id and message_hash=p_hash) then return '{"duplicate":true}'; end if;
  insert into public.ig_dm_redirect_contacts(user_id,sender_id) values(cfg.user_id,p_sender) on conflict do nothing;
  select * into person from public.ig_dm_redirect_contacts where user_id=cfg.user_id and sender_id=p_sender for update;
  if p_stop or person.opted_out then
    outcome:='opted_out';
    update public.ig_dm_redirect_contacts set opted_out=true where user_id=cfg.user_id and sender_id=p_sender;
  elsif person.last_attempt_at > now()-interval '24 hours' then
    outcome:='cooldown';
  else
    outcome:='reserved';
    if person.previous_variant is null then chosen:=floor(random()*30)::integer;
    else
      chosen:=floor(random()*29)::integer;
      if chosen>=person.previous_variant then chosen:=chosen+1; end if;
    end if;
    update public.ig_dm_redirect_contacts set last_attempt_at=now(),previous_variant=chosen where user_id=cfg.user_id and sender_id=p_sender;
  end if;
  insert into public.ig_dm_redirect_receipts(user_id,message_hash,sender_id,event_at,variant,status)
    values(cfg.user_id,p_hash,p_sender,p_event_at,chosen,outcome);
  update public.ig_dm_redirect_settings set last_received_at=now() where user_id=cfg.user_id;
  return jsonb_build_object('send',outcome='reserved','variant',chosen,'user_id',cfg.user_id);
end $$;
revoke all on function public.ig_dm_redirect_reserve(text,text,text,timestamptz,boolean,text) from public,anon,authenticated;
grant execute on function public.ig_dm_redirect_reserve(text,text,text,timestamptz,boolean,text) to service_role;
