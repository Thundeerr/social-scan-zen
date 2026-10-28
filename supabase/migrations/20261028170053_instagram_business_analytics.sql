-- Read-only provider integration; no changes to publishing connections or queues.
create table public.instagram_analytics_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_attempt_at timestamptz not null default 'epoch',
  last_synced_at timestamptz,
  last_error text,
  reels jsonb not null default '[]' check (jsonb_typeof(reels) = 'array'),
  warnings jsonb not null default '[]' check (jsonb_typeof(warnings) = 'array')
);
comment on table public.instagram_analytics_state is 'Kiikii analytics only. Atomic attempt timestamp throttles concurrent callers. Latest 25 media sampled; reel metrics are lifetime, not daily. No tokens stored here.';
alter table public.instagram_analytics_state enable row level security;
revoke all on public.instagram_analytics_state from anon, authenticated;
grant select on public.instagram_analytics_state to authenticated;
grant all on public.instagram_analytics_state to service_role;
create policy owner_read on public.instagram_analytics_state for select to authenticated using ((select auth.uid()) = user_id);
