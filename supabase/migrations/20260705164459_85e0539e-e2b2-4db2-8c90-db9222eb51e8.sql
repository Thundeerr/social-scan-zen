
-- profiles: owner or operator can SELECT
DROP POLICY IF EXISTS "Operators can view all profiles" ON public.profiles;
CREATE POLICY "Owner or operator can view profiles"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = id OR public.is_operator(auth.uid()));

-- user_roles: own row or operator
DROP POLICY IF EXISTS "Operators can view all roles" ON public.user_roles;
CREATE POLICY "Own roles or operator can view roles"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id OR public.is_operator(auth.uid()));

-- Internal ops tables: SELECT restricted to operators
DROP POLICY IF EXISTS "auth read activity_log" ON public.activity_log;
CREATE POLICY "ops read activity_log" ON public.activity_log
  FOR SELECT TO authenticated USING (public.is_operator(auth.uid()));

DROP POLICY IF EXISTS "auth read asset_downloads" ON public.asset_downloads;
CREATE POLICY "ops read asset_downloads" ON public.asset_downloads
  FOR SELECT TO authenticated USING (public.is_operator(auth.uid()));

DROP POLICY IF EXISTS "auth read asset_status" ON public.asset_status;
CREATE POLICY "ops read asset_status" ON public.asset_status
  FOR SELECT TO authenticated USING (public.is_operator(auth.uid()));

DROP POLICY IF EXISTS "auth read assets" ON public.assets;
CREATE POLICY "ops read assets" ON public.assets
  FOR SELECT TO authenticated USING (public.is_operator(auth.uid()));

DROP POLICY IF EXISTS "auth read provider_budget" ON public.provider_budget;
CREATE POLICY "ops read provider_budget" ON public.provider_budget
  FOR SELECT TO authenticated USING (public.is_operator(auth.uid()));

DROP POLICY IF EXISTS "auth read scanner_runs" ON public.scanner_runs;
CREATE POLICY "ops read scanner_runs" ON public.scanner_runs
  FOR SELECT TO authenticated USING (public.is_operator(auth.uid()));

DROP POLICY IF EXISTS "auth read tracked_accounts" ON public.tracked_accounts;
CREATE POLICY "ops read tracked_accounts" ON public.tracked_accounts
  FOR SELECT TO authenticated USING (public.is_operator(auth.uid()));

DROP POLICY IF EXISTS "auth read watchlist_accounts" ON public.watchlist_accounts;
CREATE POLICY "ops read watchlist_accounts" ON public.watchlist_accounts
  FOR SELECT TO authenticated USING (public.is_operator(auth.uid()));

DROP POLICY IF EXISTS "auth read watchlists" ON public.watchlists;
CREATE POLICY "ops read watchlists" ON public.watchlists
  FOR SELECT TO authenticated USING (public.is_operator(auth.uid()));

-- Lock down SECURITY DEFINER role-check helpers so PostgREST can't call them
-- directly with anon/authenticated JWTs. They're still callable from RLS
-- policies and from server code using the service role.
REVOKE EXECUTE ON FUNCTION public.is_operator(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_operator(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO service_role;
