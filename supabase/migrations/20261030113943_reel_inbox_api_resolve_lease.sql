-- Reserve at most one server-side provider lookup per existing Inbox lease.
-- No generation jobs, media storage, credentials or caller-supplied URLs.
alter table public.reel_inbox_items add column api_resolve_lease uuid;

create function public.reel_inbox_resolve_source(
  p_id uuid,
  p_lease uuid,
  p_device_hash text
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  source jsonb;
  actor uuid;
  previous_lease uuid;
  monthly_cap integer;
  run_id uuid;
  period_start timestamptz := date_trunc('month', now() at time zone 'UTC') at time zone 'UTC';
  period_end timestamptz := (date_trunc('month', now() at time zone 'UTC') + interval '1 month') at time zone 'UTC';
begin
  -- Reuse the same device ownership, revocation, expiry and active-lease checks.
  -- renew locks the device and item until this transaction has committed.
  perform public.reel_inbox_command(
    'renew', null, jsonb_build_object('id', p_id, 'lease', p_lease), p_device_hash
  );

  select user_id, api_resolve_lease into actor, previous_lease
  from public.reel_inbox_items where id = p_id;
  if previous_lease = p_lease then return null; end if;

  -- Keep fallback reservations serialized even when the optional budget row is absent.
  perform pg_advisory_xact_lock(hashtextextended('reel-inbox-provider-budget', 0));
  select budget.monthly_cap into monthly_cap
  from public.provider_budget budget where id = true for update;
  monthly_cap := coalesce(monthly_cap, 15000);
  if (select count(*) from public.scanner_runs
      where created_at >= period_start and created_at < period_end) >= monthly_cap then
    return jsonb_build_object('error', 'setup');
  end if;

  update public.reel_inbox_items
  set api_resolve_lease = p_lease
  where id = p_id
    and lease_id = p_lease
    and api_resolve_lease is distinct from p_lease
  returning jsonb_build_object('canonical_url', canonical_url, 'shortcode', shortcode)
  into source;

  if source is null then return null; end if;
  -- A completed reservation counts toward existing usage without entering the scan queue.
  -- The server replaces this neutral detail with the lookup outcome after the provider call.
  insert into public.scanner_runs(status, created_by, phase, phase_detail, started_at, completed_at)
  values ('completed', actor, 'inbox_resolve', 'Reel download fallback request reserved', now(), now())
  returning id into run_id;
  return source || jsonb_build_object('run_id', run_id);
end $$;

revoke all on function public.reel_inbox_resolve_source(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.reel_inbox_resolve_source(uuid,uuid,text) to service_role;
