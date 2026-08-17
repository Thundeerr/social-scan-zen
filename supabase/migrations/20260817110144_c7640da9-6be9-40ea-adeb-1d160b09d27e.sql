CREATE OR REPLACE FUNCTION public.claim_due_monitor_accounts(_limit INTEGER DEFAULT 10, _stale_after_minutes INTEGER DEFAULT 15)
RETURNS SETOF public.monitor_accounts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.monitor_accounts a
  SET processing_started_at = now()
  WHERE a.id IN (
    SELECT c.id
    FROM public.monitor_accounts c
    WHERE c.enabled
      AND COALESCE((SELECT s.automation_enabled FROM public.monitor_settings s WHERE s.user_id = c.user_id), true)
      AND c.next_check_at <= now()
      AND (c.processing_started_at IS NULL
           OR c.processing_started_at < now() - make_interval(mins => _stale_after_minutes))
    ORDER BY c.next_check_at ASC
    LIMIT _limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING a.*;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.claim_due_monitor_accounts(INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_monitor_accounts(INTEGER, INTEGER) TO service_role;