-- Reporting only: never changes generation budgets, jobs or publishing.
create table public.business_report_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  monthly_budget_cents integer not null default 40000 check(monthly_budget_cents > 0),
  updated_at timestamptz not null default now()
);
create table public.business_cost_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  reference text not null,
  label text not null,
  scope text not null check(scope in ('kiikii','shared','tuuva')),
  kind text not null check(kind in ('fixed','topup','usage')),
  cents integer not null check(cents >= 0),
  day date not null,
  end_day date,
  note text not null default '',
  updated_at timestamptz not null default now(),
  unique(user_id,reference),
  check(end_day is null or end_day >= day)
);
comment on table public.business_cost_entries is 'USD only. Fixed rows recur monthly from day through end_day. Topups are cash movements, never added to usage. Shared costs are not automatically attributed to Kiikii.';
create index business_cost_owner_day on public.business_cost_entries(user_id,day);
create table public.business_metric_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null,
  period_start date not null,
  period_end date not null,
  observed_at timestamptz not null,
  values jsonb not null check(jsonb_typeof(values)='object'),
  note text not null,
  unique(user_id,source,period_start,period_end),
  check(period_end >= period_start)
);
comment on table public.business_metric_snapshots is 'Period-labelled evidence, not necessarily current-day or API data. Never infer a zero from a missing metric.';
create index business_snapshot_latest on public.business_metric_snapshots(user_id,source,observed_at desc);
create table public.business_report_deliveries (
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null,
  state text not null default 'sending' check(state in ('sending','sent','uncertain')),
  message_id bigint,
  created_at timestamptz not null default now(),
  primary key(user_id,key)
);
comment on table public.business_report_deliveries is 'Reserve before Telegram side effects. Ambiguous deliveries are never automatically resent. Unique keys deduplicate daily reports, monthly alert levels and inbound updates.';
do $$ declare t text; begin
  foreach t in array array['business_report_settings','business_cost_entries','business_metric_snapshots','business_report_deliveries'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon,authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('grant all on public.%I to service_role',t);
    execute format('create policy owner_read on public.%I for select to authenticated using ((select auth.uid()) = user_id)',t);
  end loop;
end $$;

create function public.business_live_status(p_user uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  with bounds as (select (now() at time zone 'Europe/Berlin')::date as day),
  posts as (select p.* from public.content_posts p where p.user_id=p_user and exists
    (select 1 from public.content_review_items r where r.user_id=p_user and r.model='kiikii' and r.publish_post_id=p.id))
  select jsonb_build_object(
    'read_at',now(),
    'jobs_today',(select count(*) from public.model_pipeline_jobs where user_id=p_user and model='kiikii' and (created_at at time zone 'Europe/Berlin')::date=b.day),
    'review_pending',(select count(*) from public.content_review_items where user_id=p_user and model='kiikii' and status='pending'),
    'scheduled',(select count(*) from posts where status='scheduled' and scheduled_for >= now()),
    'last_scheduled',(select max(scheduled_for) from posts where status='scheduled' and scheduled_for >= now()),
    'published_today',(select count(*) from posts where status='published' and (published_at at time zone 'Europe/Berlin')::date=b.day),
    'reserved_month_cents',(select coalesce(sum(reserved_cents),0) from public.model_pipeline_jobs where user_id=p_user and model='kiikii' and reserved_day between date_trunc('month',b.day)::date and b.day)
  ) from bounds b;
$$;
revoke all on function public.business_live_status(uuid) from public,anon,authenticated;
grant execute on function public.business_live_status(uuid) to service_role;
