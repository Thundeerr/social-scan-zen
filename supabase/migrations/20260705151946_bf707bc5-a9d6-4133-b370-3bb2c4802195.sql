
-- =========================================================================
-- Instagram publishing pipeline — foundation (step 1 of 6)
-- =========================================================================

-- ------------------------------------------------------------------
-- profiles: publishing pause toggle (per-operator kill switch)
-- ------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS publishing_paused boolean NOT NULL DEFAULT false;

-- ------------------------------------------------------------------
-- ig_connections: one Instagram destination per operator
-- ------------------------------------------------------------------
CREATE TABLE public.ig_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ig_user_id text NOT NULL,
  ig_username text NOT NULL,
  page_id text NOT NULL,
  page_access_token text NOT NULL,
  token_expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'active',
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

-- Non-secret row per operator. Client MAY read own row (for status/username/expiry),
-- but MUST NOT read the token — server-only server fns fetch the token via service role.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ig_connections TO authenticated;
GRANT ALL ON public.ig_connections TO service_role;

ALTER TABLE public.ig_connections ENABLE ROW LEVEL SECURITY;

-- Client policies: owner reads/writes own row, but exclude access token via a view or
-- rely on always fetching sensitive fields server-side. We keep RLS scoped to owner,
-- and the client never selects `page_access_token` in queries (server fns only).
CREATE POLICY "ig_connections owner read"
  ON public.ig_connections FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "ig_connections owner insert"
  ON public.ig_connections FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "ig_connections owner update"
  ON public.ig_connections FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "ig_connections owner delete"
  ON public.ig_connections FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER trg_ig_connections_updated
  BEFORE UPDATE ON public.ig_connections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ------------------------------------------------------------------
-- publish_jobs: state machine for one Approved asset → IG post
-- ------------------------------------------------------------------
CREATE TABLE public.publish_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued',
  caption text,
  rehosted_url text,
  storage_path text,
  ig_container_id text,
  ig_post_id text,
  ig_permalink text,
  attempts int NOT NULL DEFAULT 0,
  error text,
  scheduled_for timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- One live job per asset. Re-approving the same asset does NOT re-publish.
  UNIQUE (asset_id)
);

CREATE INDEX idx_publish_jobs_status_scheduled
  ON public.publish_jobs (status, scheduled_for)
  WHERE status IN ('queued', 'rehosting', 'drafting', 'uploading', 'publishing');

CREATE INDEX idx_publish_jobs_user_created
  ON public.publish_jobs (user_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.publish_jobs TO authenticated;
GRANT ALL ON public.publish_jobs TO service_role;

ALTER TABLE public.publish_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "publish_jobs owner read"
  ON public.publish_jobs FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "publish_jobs owner update"
  ON public.publish_jobs FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "publish_jobs owner delete"
  ON public.publish_jobs FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- No client INSERT policy: rows are created by the trigger below (SECURITY DEFINER)
-- and by the worker via service_role. This prevents operators from forging jobs
-- for assets they don't own.

CREATE TRIGGER trg_publish_jobs_updated
  BEFORE UPDATE ON public.publish_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ------------------------------------------------------------------
-- assets: publish state chips for the Inbox UI
-- ------------------------------------------------------------------
ALTER TABLE public.assets
  ADD COLUMN IF NOT EXISTS publish_status text,
  ADD COLUMN IF NOT EXISTS ig_post_id text,
  ADD COLUMN IF NOT EXISTS ig_permalink text;

-- ------------------------------------------------------------------
-- Trigger: enqueue a publish job on asset_status → 'approved'
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enqueue_publish_on_approve()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
  v_paused boolean;
  v_has_conn boolean;
BEGIN
  -- Only fire on transitions INTO 'approved'.
  IF NEW.state IS DISTINCT FROM 'approved' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.state = 'approved' THEN
    RETURN NEW;
  END IF;

  -- Resolve the asset's owner via tracked_accounts.created_by.
  SELECT ta.created_by
    INTO v_owner
    FROM public.assets a
    JOIN public.tracked_accounts ta ON ta.id = a.account_id
   WHERE a.id = NEW.asset_id;

  IF v_owner IS NULL THEN
    RETURN NEW;
  END IF;

  -- Skip if the operator has paused publishing.
  SELECT COALESCE(publishing_paused, false) INTO v_paused
    FROM public.profiles WHERE id = v_owner;
  IF v_paused THEN
    RETURN NEW;
  END IF;

  -- Skip if there is no active Instagram connection.
  SELECT EXISTS (
    SELECT 1 FROM public.ig_connections
     WHERE user_id = v_owner AND status = 'active'
  ) INTO v_has_conn;
  IF NOT v_has_conn THEN
    RETURN NEW;
  END IF;

  -- Idempotent: unique(asset_id) means re-approval is a no-op.
  INSERT INTO public.publish_jobs (asset_id, user_id, status)
  VALUES (NEW.asset_id, v_owner, 'queued')
  ON CONFLICT (asset_id) DO NOTHING;

  -- Mirror the publish state onto the asset for cheap UI reads.
  UPDATE public.assets
     SET publish_status = 'queued'
   WHERE id = NEW.asset_id
     AND (publish_status IS NULL OR publish_status = 'failed');

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enqueue_publish_on_approve_ins
  AFTER INSERT ON public.asset_status
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_publish_on_approve();

CREATE TRIGGER trg_enqueue_publish_on_approve_upd
  AFTER UPDATE OF state ON public.asset_status
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_publish_on_approve();

-- ------------------------------------------------------------------
-- Storage RLS: ig-publish bucket (private)
-- ------------------------------------------------------------------
-- Path convention: {user_id}/{asset_id}.{ext}
CREATE POLICY "ig-publish owner read"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'ig-publish'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- No client INSERT/UPDATE/DELETE policies — only service_role (server-side
-- rehoster) writes to this bucket. Meta reads via short-lived signed URL.
