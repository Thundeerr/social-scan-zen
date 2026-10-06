-- Separate intake configuration; never modifies the publishing connection.
create table public.reel_inbox_dm_sources (
  user_id uuid primary key references auth.users(id),
  receiver_id text not null unique check(receiver_id ~ '^[0-9]{1,40}$'),
  enabled boolean not null default false,
  last_received_at timestamptz
);
create table public.reel_inbox_dm_senders (
  user_id uuid not null references public.reel_inbox_dm_sources(user_id),
  username text not null check(username in ('kiikii.bat','thundeerr999')),
  sender_id text not null check(sender_id ~ '^[0-9]{1,40}$'),
  primary key(user_id, username), unique(user_id,sender_id)
);
create table public.reel_inbox_dm_receipts (
  user_id uuid not null references public.reel_inbox_dm_sources(user_id),
  message_hash text not null check(message_hash ~ '^[a-f0-9]{64}$'),
  sender text not null check(sender in ('kiikii.bat','thundeerr999')),
  status text not null check(status in ('queued','no_reel_link')),
  link_count integer not null check(link_count between 0 and 50),
  received_at timestamptz not null default now(),
  primary key(user_id,message_hash)
);
alter table public.reel_inbox_dm_sources enable row level security;
alter table public.reel_inbox_dm_senders enable row level security;
alter table public.reel_inbox_dm_receipts enable row level security;
revoke all on public.reel_inbox_dm_sources, public.reel_inbox_dm_senders, public.reel_inbox_dm_receipts from public,anon,authenticated;
grant all on public.reel_inbox_dm_sources, public.reel_inbox_dm_senders, public.reel_inbox_dm_receipts to service_role;

-- The server verifies Meta's HMAC and resolves sender identity before calling this.
-- Authorization, replay dedupe and enqueue are rechecked atomically here.
create function public.reel_inbox_dm_ingest(p_receiver text,p_sender text,p_username text,p_hash text,p_links jsonb)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare src public.reel_inbox_dm_sources; bound text; result jsonb;
begin
  select * into src from public.reel_inbox_dm_sources where receiver_id=p_receiver and enabled for update;
  if not found then return '{"ignored":true}'; end if;
  if not exists(select 1 from public.user_roles where user_id=src.user_id and role in ('owner','cofounder')) then return '{"ignored":true}'; end if;
  if p_username is null or p_username not in ('kiikii.bat','thundeerr999') or p_sender is null or p_sender !~ '^[0-9]{1,40}$' then return '{"ignored":true}'; end if;
  select sender_id into bound from public.reel_inbox_dm_senders where user_id=src.user_id and username=p_username;
  if found and bound<>p_sender then return '{"ignored":true}'; end if;
  if exists(select 1 from public.reel_inbox_dm_senders where user_id=src.user_id and sender_id=p_sender and username<>p_username) then return '{"ignored":true}'; end if;
  if jsonb_typeof(p_links) is distinct from 'array' or jsonb_array_length(p_links)>50 then raise exception 'invalid links'; end if;
  insert into public.reel_inbox_dm_senders values(src.user_id,p_username,p_sender) on conflict do nothing;
  if exists(select 1 from public.reel_inbox_dm_receipts where user_id=src.user_id and message_hash=p_hash) then return '{"duplicate":true}'; end if;
  if (select count(*) from public.reel_inbox_dm_receipts where user_id=src.user_id)>=50000 then raise exception 'receipt limit'; end if;
  result:=public.reel_inbox_command('submit',src.user_id,jsonb_build_object('links',p_links,'test',false));
  insert into public.reel_inbox_dm_receipts(user_id,message_hash,sender,status,link_count)
  values(src.user_id,p_hash,p_username,case when jsonb_array_length(p_links)>0 then 'queued' else 'no_reel_link' end,jsonb_array_length(p_links));
  update public.reel_inbox_dm_sources set last_received_at=now() where user_id=src.user_id;
  return jsonb_build_object('results',result);
end $$;
revoke all on function public.reel_inbox_dm_ingest(text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.reel_inbox_dm_ingest(text,text,text,text,jsonb) to service_role;
