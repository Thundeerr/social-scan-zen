-- Read-only accounting collector. No provider key leaves the VPS.
create table public.wavespeed_analytics_state (
 user_id uuid primary key references auth.users(id) on delete cascade,
 requested_at timestamptz not null default now(),
 last_attempt_at timestamptz not null default 'epoch',
 last_synced_at timestamptz,
 last_error text,
 report jsonb,
 ledger jsonb
);
alter table public.wavespeed_analytics_state enable row level security;
revoke all on public.wavespeed_analytics_state from public,anon,authenticated;
grant all on public.wavespeed_analytics_state to service_role;
comment on table public.wavespeed_analytics_state is 'Server-only WaveSpeed monthly ledger and totals. Existing worker credential authenticates collector; never starts generation. Unknown attribution stays unknown.';
create table public.wavespeed_monthly_reports (
 user_id uuid not null references auth.users(id) on delete cascade,
 month text not null check (month ~ '^\d{4}-\d{2}$'),
 observed_at timestamptz not null,
 report jsonb not null,
 ledger jsonb not null,
 primary key(user_id,month)
);
alter table public.wavespeed_monthly_reports enable row level security;
revoke all on public.wavespeed_monthly_reports from public,anon,authenticated;
grant all on public.wavespeed_monthly_reports to service_role;
comment on table public.wavespeed_monthly_reports is 'Retains each collected calendar-month ledger; no double-counting repeated syncs. Completeness is bounded by observed_at.';
