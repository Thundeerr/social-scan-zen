ALTER TABLE public.monitor_actions
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS blocked_reason text,
  ADD COLUMN IF NOT EXISTS dispatched_at timestamptz,
  ADD COLUMN IF NOT EXISTS provider_status text,
  ADD COLUMN IF NOT EXISTS provider_status_checked_at timestamptz;

CREATE INDEX IF NOT EXISTS monitor_actions_next_attempt_idx
  ON public.monitor_actions (next_attempt_at)
  WHERE status IN ('queued', 'failed', 'unknown_outcome');

ALTER TABLE public.monitor_settings
  ADD COLUMN IF NOT EXISTS orders_paused boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS daily_action_cap integer NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS monthly_action_cap integer NOT NULL DEFAULT 500,
  ADD COLUMN IF NOT EXISTS max_quantity_per_action integer NOT NULL DEFAULT 10000,
  ADD COLUMN IF NOT EXISTS min_provider_balance numeric NOT NULL DEFAULT 0;