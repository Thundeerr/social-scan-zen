ALTER TABLE public.ig_connections ALTER COLUMN page_id DROP NOT NULL;

ALTER TABLE public.ig_connections
  ADD COLUMN IF NOT EXISTS login_type text NOT NULL DEFAULT 'instagram_login';
DO $$ BEGIN
  ALTER TABLE public.ig_connections
    ADD CONSTRAINT ig_connections_login_type_check
    CHECK (login_type IN ('instagram_login', 'facebook_login'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.ig_connections
  ADD COLUMN IF NOT EXISTS granted_scopes text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.ig_connections
  ADD COLUMN IF NOT EXISTS token_refreshed_at timestamptz;

REVOKE SELECT, INSERT, UPDATE, DELETE ON public.ig_connections FROM authenticated;
GRANT SELECT (
  id, user_id, ig_user_id, ig_username, page_id, token_expires_at, status,
  last_error, api_base_url, login_type, granted_scopes, token_refreshed_at,
  created_at, updated_at
) ON public.ig_connections TO authenticated;
GRANT ALL ON public.ig_connections TO service_role;

DROP POLICY IF EXISTS "ig_connections owner insert" ON public.ig_connections;
DROP POLICY IF EXISTS "ig_connections owner update" ON public.ig_connections;
DROP POLICY IF EXISTS "ig_connections owner delete" ON public.ig_connections;

CREATE TABLE IF NOT EXISTS public.ig_oauth_states (
  state text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  redirect_uri text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON public.ig_oauth_states FROM PUBLIC;
REVOKE ALL ON public.ig_oauth_states FROM anon;
REVOKE ALL ON public.ig_oauth_states FROM authenticated;
GRANT ALL ON public.ig_oauth_states TO service_role;
ALTER TABLE public.ig_oauth_states ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_ig_oauth_states_expires ON public.ig_oauth_states (expires_at);

CREATE OR REPLACE FUNCTION public.purge_ig_oauth_states()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  DELETE FROM public.ig_oauth_states
  WHERE expires_at < now() - interval '1 hour' OR consumed_at IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.purge_ig_oauth_states() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.purge_ig_oauth_states() FROM anon;
REVOKE ALL ON FUNCTION public.purge_ig_oauth_states() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.purge_ig_oauth_states() TO service_role;