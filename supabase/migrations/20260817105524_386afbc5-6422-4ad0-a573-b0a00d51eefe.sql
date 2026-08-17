-- ============ monitor_settings ============
CREATE TABLE public.monitor_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  default_interval_minutes INTEGER NOT NULL DEFAULT 180 CHECK (default_interval_minutes BETWEEN 180 AND 2880),
  cooldown_minutes INTEGER NOT NULL DEFAULT 1440 CHECK (cooldown_minutes >= 1),
  automation_enabled BOOLEAN NOT NULL DEFAULT true,
  batch_size INTEGER NOT NULL DEFAULT 10 CHECK (batch_size BETWEEN 1 AND 50),
  adapter_base_url TEXT NOT NULL DEFAULT 'https://justanotherpanel.com/api/v2',
  adapter_service_reference TEXT,
  adapter_default_quantity INTEGER,
  adapter_configured_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.monitor_settings TO authenticated;
GRANT ALL ON public.monitor_settings TO service_role;
ALTER TABLE public.monitor_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own settings select" ON public.monitor_settings FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "own settings insert" ON public.monitor_settings FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "own settings update" ON public.monitor_settings FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ============ monitor_accounts ============
CREATE TABLE public.monitor_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  normalized_username TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  is_private BOOLEAN,
  status_initialized BOOLEAN NOT NULL DEFAULT false,
  last_checked_at TIMESTAMPTZ,
  next_check_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  interval_minutes INTEGER CHECK (interval_minutes IS NULL OR interval_minutes BETWEEN 180 AND 2880),
  last_error TEXT,
  last_event_at TIMESTAMPTZ,
  processing_started_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, normalized_username)
);
CREATE INDEX monitor_accounts_due_idx ON public.monitor_accounts (next_check_at) WHERE enabled;
CREATE INDEX monitor_accounts_user_idx ON public.monitor_accounts (user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.monitor_accounts TO authenticated;
GRANT ALL ON public.monitor_accounts TO service_role;
ALTER TABLE public.monitor_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own monitor accounts" ON public.monitor_accounts FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.owns_monitor_account(_account_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.monitor_accounts a
    WHERE a.id = _account_id AND a.user_id = auth.uid()
  )
$$;

-- ============ monitor_checks ============
CREATE TABLE public.monitor_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.monitor_accounts(id) ON DELETE CASCADE,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  result TEXT NOT NULL CHECK (result IN ('private','public','error')),
  previous_is_private BOOLEAN,
  current_is_private BOOLEAN,
  response_excerpt TEXT,
  error_message TEXT
);
CREATE INDEX monitor_checks_account_idx ON public.monitor_checks (account_id, checked_at DESC);
GRANT SELECT ON public.monitor_checks TO authenticated;
GRANT ALL ON public.monitor_checks TO service_role;
ALTER TABLE public.monitor_checks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own checks select" ON public.monitor_checks FOR SELECT TO authenticated USING (public.owns_monitor_account(account_id));

-- ============ monitor_events ============
CREATE TABLE public.monitor_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.monitor_accounts(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL DEFAULT 'profile_became_public',
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('automatic','manual')),
  transition_key TEXT NOT NULL,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  cooldown_minutes INTEGER,
  cooldown_suppressed BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'created',
  UNIQUE (account_id, transition_key)
);
CREATE INDEX monitor_events_account_idx ON public.monitor_events (account_id, detected_at DESC);
GRANT SELECT ON public.monitor_events TO authenticated;
GRANT ALL ON public.monitor_events TO service_role;
ALTER TABLE public.monitor_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own events select" ON public.monitor_events FOR SELECT TO authenticated USING (public.owns_monitor_account(account_id));

-- ============ monitor_action_templates ============
CREATE TABLE public.monitor_action_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.monitor_accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  service_reference TEXT,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 1),
  target_template TEXT NOT NULL DEFAULT 'https://instagram.com/{username}',
  position INTEGER NOT NULL DEFAULT 0,
  enabled BOOLEAN NOT NULL DEFAULT true,
  dry_run BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX monitor_templates_account_idx ON public.monitor_action_templates (account_id, position);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.monitor_action_templates TO authenticated;
GRANT ALL ON public.monitor_action_templates TO service_role;
ALTER TABLE public.monitor_action_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own templates" ON public.monitor_action_templates FOR ALL TO authenticated
  USING (public.owns_monitor_account(account_id)) WITH CHECK (public.owns_monitor_account(account_id));

-- ============ monitor_actions ============
CREATE TABLE public.monitor_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.monitor_events(id) ON DELETE CASCADE,
  template_id UUID NOT NULL REFERENCES public.monitor_action_templates(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.monitor_accounts(id) ON DELETE CASCADE,
  target TEXT NOT NULL,
  quantity INTEGER,
  service_reference TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','not_configured','completed','failed','unknown_outcome')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  provider_reference TEXT,
  request_excerpt JSONB,
  response_excerpt JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, template_id)
);
CREATE INDEX monitor_actions_account_idx ON public.monitor_actions (account_id, created_at DESC);
GRANT SELECT ON public.monitor_actions TO authenticated;
GRANT ALL ON public.monitor_actions TO service_role;
ALTER TABLE public.monitor_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own actions select" ON public.monitor_actions FOR SELECT TO authenticated USING (public.owns_monitor_account(account_id));

-- ============ monitor_scheduler_runs ============
CREATE TABLE public.monitor_scheduler_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  checked_accounts INTEGER NOT NULL DEFAULT 0,
  created_events INTEGER NOT NULL DEFAULT 0,
  created_actions INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'running'
);
CREATE INDEX monitor_runs_started_idx ON public.monitor_scheduler_runs (started_at DESC);
GRANT SELECT ON public.monitor_scheduler_runs TO authenticated;
GRANT ALL ON public.monitor_scheduler_runs TO service_role;
ALTER TABLE public.monitor_scheduler_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "runs visible to operators" ON public.monitor_scheduler_runs FOR SELECT TO authenticated USING (true);

-- ============ claim function ============
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
    LEFT JOIN public.monitor_settings s ON s.user_id = c.user_id
    WHERE c.enabled
      AND COALESCE(s.automation_enabled, true)
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

-- ============ updated_at triggers ============
CREATE TRIGGER monitor_settings_updated_at BEFORE UPDATE ON public.monitor_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER monitor_accounts_updated_at BEFORE UPDATE ON public.monitor_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER monitor_templates_updated_at BEFORE UPDATE ON public.monitor_action_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER monitor_actions_updated_at BEFORE UPDATE ON public.monitor_actions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ realtime ============
ALTER TABLE public.monitor_accounts REPLICA IDENTITY FULL;
ALTER TABLE public.monitor_checks REPLICA IDENTITY FULL;
ALTER TABLE public.monitor_events REPLICA IDENTITY FULL;
ALTER TABLE public.monitor_actions REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.monitor_accounts;
ALTER PUBLICATION supabase_realtime ADD TABLE public.monitor_checks;
ALTER PUBLICATION supabase_realtime ADD TABLE public.monitor_events;
ALTER PUBLICATION supabase_realtime ADD TABLE public.monitor_actions;

-- ============ backfill settings for existing users ============
INSERT INTO public.monitor_settings (user_id)
SELECT id FROM auth.users ON CONFLICT DO NOTHING;