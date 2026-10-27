-- Credentials live encrypted in Vault. Browser roles cannot read these tables or RPCs.
create table public.fanvue_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  secret_id uuid not null unique,
  handle text,
  connected boolean not null default false,
  needs_reconnect boolean not null default false,
  last_synced_at timestamptz,
  last_attempt_at timestamptz,
  last_error text,
  lease_id uuid,
  lease_until timestamptz not null default '-infinity',
  refresh_pending boolean not null default false
);
create table public.fanvue_oauth_states (
  state_hash text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  browser_hash text not null,
  verifier text not null,
  expires_at timestamptz not null
);
create index fanvue_oauth_states_expiry_idx on public.fanvue_oauth_states(expires_at);
alter table public.fanvue_connections enable row level security;
alter table public.fanvue_oauth_states enable row level security;
revoke all on public.fanvue_connections, public.fanvue_oauth_states from public, anon, authenticated;
grant all on public.fanvue_connections, public.fanvue_oauth_states to service_role;
comment on table public.fanvue_connections is 'Server-only Fanvue analytics connection metadata; encrypted credentials in Vault.';
comment on table public.fanvue_oauth_states is 'Ten-minute, single-use PKCE states bound to an HttpOnly browser cookie and authenticated owner.';

create function public.fanvue_secret_get(p_user uuid) returns jsonb
language sql security definer set search_path = '' as $$
  select v.decrypted_secret::jsonb from public.fanvue_connections c
  join vault.decrypted_secrets v on v.id=c.secret_id where c.user_id=p_user;
$$;
create function public.fanvue_secret_put(p_user uuid, p_value jsonb, p_lease uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_lease uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 716));
  select secret_id,lease_id into v_id,v_lease from public.fanvue_connections where user_id=p_user for update;
  if v_id is null then
    if p_lease is not null then raise exception 'Connection missing'; end if;
    select vault.create_secret(p_value::text, 'fanvue-analytics-' || p_user::text) into v_id;
    insert into public.fanvue_connections(user_id,secret_id) values(p_user,v_id);
  else
    if p_lease is null or p_lease is distinct from v_lease then raise exception 'Connection lease required'; end if;
    perform vault.update_secret(v_id,p_value::text);
  end if;
end;
$$;
revoke all on function public.fanvue_secret_get(uuid), public.fanvue_secret_put(uuid,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.fanvue_secret_get(uuid), public.fanvue_secret_put(uuid,jsonb,uuid) to service_role;
