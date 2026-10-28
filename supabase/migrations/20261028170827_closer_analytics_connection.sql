-- Server-only provider credentials. No generation, chat or publishing privileges added.
create table public.closer_analytics_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  secret_id uuid not null unique,
  last_attempt_at timestamptz not null default 'epoch',
  last_synced_at timestamptz,
  last_error text,
  verified boolean not null default false
);
alter table public.closer_analytics_connections enable row level security;
revoke all on public.closer_analytics_connections from public,anon,authenticated;
grant all on public.closer_analytics_connections to service_role;
comment on table public.closer_analytics_connections is 'Private CupidBot analytics metadata; token encrypted in Vault. Fixed Kiikii account filter. Browser gets only sanitized status through server function.';
create function public.closer_analytics_secret_get(p_user uuid) returns text
language sql security definer set search_path = '' as $$
 select v.decrypted_secret from public.closer_analytics_connections c join vault.decrypted_secrets v on v.id=c.secret_id where c.user_id=p_user;
$$;
create function public.closer_analytics_secret_put(p_user uuid,p_token text) returns void
language plpgsql security definer set search_path = '' as $$
declare sid uuid; attempted timestamptz;
begin
 if length(p_token)<16 or length(p_token)>4096 then raise exception 'Invalid token'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,717));
 select secret_id,last_attempt_at into sid,attempted from public.closer_analytics_connections where user_id=p_user for update;
 if attempted>now()-interval '1 minute' then raise exception 'Sync in progress'; end if;
 if sid is null then
  select vault.create_secret(p_token,'closer-analytics-'||p_user::text) into sid;
  insert into public.closer_analytics_connections(user_id,secret_id) values(p_user,sid);
 else
  perform vault.update_secret(sid,p_token);
  update public.closer_analytics_connections set verified=false,last_error=null,last_attempt_at='epoch' where user_id=p_user;
 end if;
end;
$$;
revoke all on function public.closer_analytics_secret_get(uuid),public.closer_analytics_secret_put(uuid,text) from public,anon,authenticated;
grant execute on function public.closer_analytics_secret_get(uuid),public.closer_analytics_secret_put(uuid,text) to service_role;
