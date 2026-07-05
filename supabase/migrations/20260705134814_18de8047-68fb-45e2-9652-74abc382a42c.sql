-- Per-account scheduling + retry state
ALTER TABLE public.tracked_accounts
  ADD COLUMN IF NOT EXISTS next_scan_at timestamptz,
  ADD COLUMN IF NOT EXISTS consecutive_failures integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error text;

-- Per-account scanner runs
ALTER TABLE public.scanner_runs
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.tracked_accounts(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS attempt integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS scheduled_for timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS scanner_runs_status_scheduled_idx
  ON public.scanner_runs (status, scheduled_for);
CREATE INDEX IF NOT EXISTS scanner_runs_account_idx
  ON public.scanner_runs (account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS tracked_accounts_next_scan_idx
  ON public.tracked_accounts (status, next_scan_at);

-- Distribute initial next_scan_at randomly across the next 90 minutes
UPDATE public.tracked_accounts
SET next_scan_at = now() + (random() * interval '90 minutes')
WHERE next_scan_at IS NULL;

-- Realtime for scanner queue + accounts
ALTER PUBLICATION supabase_realtime ADD TABLE public.scanner_runs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.tracked_accounts;
ALTER TABLE public.scanner_runs REPLICA IDENTITY FULL;
ALTER TABLE public.tracked_accounts REPLICA IDENTITY FULL;