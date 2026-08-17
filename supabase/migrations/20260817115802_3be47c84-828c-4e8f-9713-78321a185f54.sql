-- Trigger-only helper: must never be callable from the Data API.
REVOKE ALL ON FUNCTION public.set_monitor_event_user_id() FROM PUBLIC, anon, authenticated;