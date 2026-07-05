
DROP POLICY IF EXISTS "ops delete activity_log" ON public.activity_log;
DROP POLICY IF EXISTS "ops update activity_log" ON public.activity_log;

REVOKE UPDATE, DELETE ON public.activity_log FROM authenticated;

CREATE INDEX IF NOT EXISTS activity_log_event_type_idx ON public.activity_log(event_type);
CREATE INDEX IF NOT EXISTS activity_log_actor_idx ON public.activity_log(actor_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'activity_log'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.activity_log';
  END IF;
END $$;
