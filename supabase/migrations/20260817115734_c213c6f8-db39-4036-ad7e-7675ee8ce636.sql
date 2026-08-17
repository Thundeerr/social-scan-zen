-- 1. Monitor accounts: deliberate high-frequency opt-in + dedicated failure timestamp
ALTER TABLE public.monitor_accounts
  ADD COLUMN IF NOT EXISTS high_frequency_opt_in boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_failed_check_at timestamptz;

ALTER TABLE public.monitor_accounts
  DROP CONSTRAINT IF EXISTS monitor_accounts_interval_minutes_check;

-- Absolute floor is 30 minutes, but 30..179 requires an explicit per-account opt-in.
ALTER TABLE public.monitor_accounts
  ADD CONSTRAINT monitor_accounts_interval_minutes_check
  CHECK (
    interval_minutes IS NULL
    OR (interval_minutes >= 30 AND interval_minutes <= 2880)
  );

ALTER TABLE public.monitor_accounts
  ADD CONSTRAINT monitor_accounts_high_frequency_check
  CHECK (
    interval_minutes IS NULL
    OR high_frequency_opt_in
    OR interval_minutes >= 180
  );

-- Backfill the failure timestamp from existing check history.
UPDATE public.monitor_accounts a
SET last_failed_check_at = c.checked_at
FROM (
  SELECT DISTINCT ON (account_id) account_id, checked_at
  FROM public.monitor_checks
  WHERE result = 'error'
  ORDER BY account_id, checked_at DESC
) c
WHERE c.account_id = a.id;

-- 2. Denormalise the owner onto events: turns the RLS policy from a per-row
--    subquery into an indexed equality check and makes events auditable on their own.
ALTER TABLE public.monitor_events
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

UPDATE public.monitor_events e
SET user_id = a.user_id
FROM public.monitor_accounts a
WHERE a.id = e.account_id AND e.user_id IS NULL;

DELETE FROM public.monitor_events WHERE user_id IS NULL;

ALTER TABLE public.monitor_events ALTER COLUMN user_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS monitor_events_user_id_detected_at_idx
  ON public.monitor_events (user_id, detected_at DESC);

CREATE OR REPLACE FUNCTION public.set_monitor_event_user_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.user_id IS NULL THEN
    SELECT a.user_id INTO NEW.user_id
    FROM public.monitor_accounts a
    WHERE a.id = NEW.account_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_monitor_events_set_user_id ON public.monitor_events;
CREATE TRIGGER trg_monitor_events_set_user_id
  BEFORE INSERT ON public.monitor_events
  FOR EACH ROW EXECUTE FUNCTION public.set_monitor_event_user_id();

DROP POLICY IF EXISTS "own events select" ON public.monitor_events;
CREATE POLICY "own events select" ON public.monitor_events
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- 3. Scheduler run log: operators only, not every authenticated user.
DROP POLICY IF EXISTS "runs visible to operators" ON public.monitor_scheduler_runs;
CREATE POLICY "runs visible to operators" ON public.monitor_scheduler_runs
  FOR SELECT TO authenticated
  USING (public.is_operator(auth.uid()));