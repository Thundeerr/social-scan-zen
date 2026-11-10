-- Aggregate transport diagnostics contain no message text, bodies or credentials.
create table public.ig_webhook_health (
  id text primary key check(id='shared_inbox'),
  requests bigint not null default 0,
  signatures_verified bigint not null default 0,
  signatures_rejected bigint not null default 0,
  parsed_requests bigint not null default 0,
  handler_failures bigint not null default 0,
  last_request_at timestamptz,
  last_verified_at timestamptz,
  last_rejected_at timestamptz,
  last_failure_at timestamptz,
  last_summary jsonb check(jsonb_typeof(last_summary)='object' and octet_length(last_summary::text)<=2048)
);
alter table public.ig_webhook_health enable row level security;
revoke all on public.ig_webhook_health from public,anon,authenticated;
grant all on public.ig_webhook_health to service_role;
insert into public.ig_webhook_health(id) values('shared_inbox');
create function public.ig_webhook_note(p_stage text,p_summary jsonb default null)
returns void language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
  if p_stage not in('received','verified','rejected','parsed','failed') then raise exception 'Invalid diagnostic stage'; end if;
  update public.ig_webhook_health set
    requests=requests+case when p_stage='received' then 1 else 0 end,
    signatures_verified=signatures_verified+case when p_stage='verified' then 1 else 0 end,
    signatures_rejected=signatures_rejected+case when p_stage='rejected' then 1 else 0 end,
    parsed_requests=parsed_requests+case when p_stage='parsed' then 1 else 0 end,
    handler_failures=handler_failures+case when p_stage='failed' then 1 else 0 end,
    last_request_at=case when p_stage='received' then now() else last_request_at end,
    last_verified_at=case when p_stage='verified' then now() else last_verified_at end,
    last_rejected_at=case when p_stage='rejected' then now() else last_rejected_at end,
    last_failure_at=case when p_stage='failed' then now() else last_failure_at end,
    last_summary=case when p_stage='parsed' then p_summary else last_summary end
    where id='shared_inbox';
end $$;
revoke all on function public.ig_webhook_note(text,jsonb) from public,anon,authenticated;
grant execute on function public.ig_webhook_note(text,jsonb) to service_role;

alter table public.ig_comment_campaigns
  add column poll_cursor text check(length(poll_cursor)<=4096),
  add column poll_cursor_hashes text[] not null default '{}',
  add column poll_lease_token uuid,
  add column poll_lease_until timestamptz,
  add column poll_next_at timestamptz not null default now(),
  add column last_poll_at timestamptz,
  add column last_poll_completed_at timestamptz,
  add column last_poll_error text;

create function public.ig_comment_campaign_poll_claim(p_worker_hash text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare c public.ig_comment_campaigns; token uuid;
begin
  if p_worker_hash is null or p_worker_hash !~ '^[a-f0-9]{64}$' or not exists(
    select 1 from public.model_pipeline_settings where user_id='e4ee414f-fbb6-4f82-b5fc-22d74ed6b3cc' and worker_hash=p_worker_hash
  ) then return '{"authorized":false}'; end if;
  select * into c from public.ig_comment_campaigns where user_id='e4ee414f-fbb6-4f82-b5fc-22d74ed6b3cc' and media_id='18196729870394207' for update;
  if not found or not c.enabled or not exists(select 1 from public.ig_dm_redirect_settings
    where user_id=c.user_id and receiver_id='17841416918437774' and mode='off') then
    return jsonb_build_object('authorized',true,'claimed',false,'reason','paused','lastSuccessfulPollAt',c.last_poll_completed_at);
  end if;
  if c.poll_lease_until>now() then return jsonb_build_object('authorized',true,'claimed',false,'reason','busy','lastSuccessfulPollAt',c.last_poll_completed_at); end if;
  if c.poll_next_at>now() then return jsonb_build_object('authorized',true,'claimed',false,'reason','rate_limited','lastSuccessfulPollAt',c.last_poll_completed_at); end if;
  token:=gen_random_uuid();
  update public.ig_comment_campaigns set poll_lease_token=token,poll_lease_until=now()+interval '2 minutes',
    poll_next_at=now()+interval '1 minute',last_poll_at=now() where id=c.id;
  return jsonb_build_object('authorized',true,'claimed',true,'lease',token,'cursor',c.poll_cursor,'cursorHashes',c.poll_cursor_hashes);
end $$;
revoke all on function public.ig_comment_campaign_poll_claim(text) from public,anon,authenticated;
grant execute on function public.ig_comment_campaign_poll_claim(text) to service_role;

create function public.ig_comment_campaign_poll_finish(p_lease uuid,p_cursor text,p_cursor_hashes text[],p_error text default null)
returns boolean language plpgsql security invoker set search_path=pg_catalog,public as $$
declare changed integer;
begin
  if length(p_cursor)>4096 or
    exists(select 1 from unnest(p_cursor_hashes) h where h !~ '^[a-f0-9]{64}$') or
    (p_error is not null and p_error not in('poll_failed','invalid_cursor','delivery_failed')) then raise exception 'Invalid poll result'; end if;
  update public.ig_comment_campaigns set
    poll_cursor=case when p_error is null or p_error='delivery_failed' then p_cursor when p_error='invalid_cursor' then null else poll_cursor end,
    poll_cursor_hashes=case when p_error is null or p_error='delivery_failed' then coalesce(p_cursor_hashes,'{}') when p_error='invalid_cursor' then '{}' else poll_cursor_hashes end,
    poll_lease_token=null,poll_lease_until=null,last_poll_error=p_error,
    last_poll_completed_at=case when p_error is null or p_error='delivery_failed' then now() else last_poll_completed_at end
    where user_id='e4ee414f-fbb6-4f82-b5fc-22d74ed6b3cc' and media_id='18196729870394207'
      and poll_lease_token=p_lease;
  get diagnostics changed=row_count;
  return changed=1;
end $$;
revoke all on function public.ig_comment_campaign_poll_finish(uuid,text,text[],text) from public,anon,authenticated;
grant execute on function public.ig_comment_campaign_poll_finish(uuid,text,text[],text) to service_role;
