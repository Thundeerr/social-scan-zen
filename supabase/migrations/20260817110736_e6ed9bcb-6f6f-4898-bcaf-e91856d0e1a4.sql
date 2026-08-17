
-- helper: workspace owner (admin) vs. invited operator
CREATE OR REPLACE FUNCTION public.is_workspace_owner(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'owner');
$$;

CREATE OR REPLACE FUNCTION public.owns_or_is_admin(_owner uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT public.is_operator(auth.uid())
     AND (public.is_workspace_owner(auth.uid()) OR _owner = auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.can_access_asset(_asset_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.assets a
    LEFT JOIN public.tracked_accounts ta ON ta.id = a.account_id
    LEFT JOIN public.tracked_locations tl ON tl.id = a.location_id
    WHERE a.id = _asset_id
      AND public.owns_or_is_admin(COALESCE(ta.created_by, tl.created_by, a.created_by))
  );
$$;

-- tracked_accounts
DROP POLICY IF EXISTS "ops read tracked_accounts" ON public.tracked_accounts;
DROP POLICY IF EXISTS "ops update tracked_accounts" ON public.tracked_accounts;
DROP POLICY IF EXISTS "ops delete tracked_accounts" ON public.tracked_accounts;
DROP POLICY IF EXISTS "ops insert tracked_accounts" ON public.tracked_accounts;
CREATE POLICY "scoped read tracked_accounts" ON public.tracked_accounts FOR SELECT TO authenticated USING (public.owns_or_is_admin(created_by));
CREATE POLICY "scoped update tracked_accounts" ON public.tracked_accounts FOR UPDATE TO authenticated USING (public.owns_or_is_admin(created_by)) WITH CHECK (public.owns_or_is_admin(created_by));
CREATE POLICY "scoped delete tracked_accounts" ON public.tracked_accounts FOR DELETE TO authenticated USING (public.owns_or_is_admin(created_by));
CREATE POLICY "scoped insert tracked_accounts" ON public.tracked_accounts FOR INSERT TO authenticated WITH CHECK (public.is_operator(auth.uid()) AND created_by = auth.uid());

-- tracked_locations
DROP POLICY IF EXISTS "ops read tracked_locations" ON public.tracked_locations;
DROP POLICY IF EXISTS "ops insert tracked_locations" ON public.tracked_locations;
DROP POLICY IF EXISTS "ops update tracked_locations" ON public.tracked_locations;
DROP POLICY IF EXISTS "ops delete tracked_locations" ON public.tracked_locations;
DROP POLICY IF EXISTS "Operators can view tracked locations" ON public.tracked_locations;
DROP POLICY IF EXISTS "Operators can insert tracked locations" ON public.tracked_locations;
DROP POLICY IF EXISTS "Operators can update tracked locations" ON public.tracked_locations;
DROP POLICY IF EXISTS "Operators can delete tracked locations" ON public.tracked_locations;
CREATE POLICY "scoped read tracked_locations" ON public.tracked_locations FOR SELECT TO authenticated USING (public.owns_or_is_admin(created_by));
CREATE POLICY "scoped update tracked_locations" ON public.tracked_locations FOR UPDATE TO authenticated USING (public.owns_or_is_admin(created_by)) WITH CHECK (public.owns_or_is_admin(created_by));
CREATE POLICY "scoped delete tracked_locations" ON public.tracked_locations FOR DELETE TO authenticated USING (public.owns_or_is_admin(created_by));
CREATE POLICY "scoped insert tracked_locations" ON public.tracked_locations FOR INSERT TO authenticated WITH CHECK (public.is_operator(auth.uid()) AND created_by = auth.uid());

-- assets
DROP POLICY IF EXISTS "ops read assets" ON public.assets;
DROP POLICY IF EXISTS "ops update assets" ON public.assets;
DROP POLICY IF EXISTS "ops delete assets" ON public.assets;
DROP POLICY IF EXISTS "ops insert assets" ON public.assets;
CREATE POLICY "scoped read assets" ON public.assets FOR SELECT TO authenticated USING (
  public.owns_or_is_admin(COALESCE(
    (SELECT ta.created_by FROM public.tracked_accounts ta WHERE ta.id = account_id),
    (SELECT tl.created_by FROM public.tracked_locations tl WHERE tl.id = assets.location_id),
    created_by))
);
CREATE POLICY "scoped update assets" ON public.assets FOR UPDATE TO authenticated USING (
  public.owns_or_is_admin(COALESCE(
    (SELECT ta.created_by FROM public.tracked_accounts ta WHERE ta.id = account_id),
    (SELECT tl.created_by FROM public.tracked_locations tl WHERE tl.id = assets.location_id),
    created_by))
) WITH CHECK (public.is_operator(auth.uid()));
CREATE POLICY "scoped delete assets" ON public.assets FOR DELETE TO authenticated USING (
  public.owns_or_is_admin(COALESCE(
    (SELECT ta.created_by FROM public.tracked_accounts ta WHERE ta.id = account_id),
    (SELECT tl.created_by FROM public.tracked_locations tl WHERE tl.id = assets.location_id),
    created_by))
);
CREATE POLICY "scoped insert assets" ON public.assets FOR INSERT TO authenticated WITH CHECK (public.is_operator(auth.uid()));

-- asset_status
DROP POLICY IF EXISTS "ops read asset_status" ON public.asset_status;
DROP POLICY IF EXISTS "ops update asset_status" ON public.asset_status;
DROP POLICY IF EXISTS "ops delete asset_status" ON public.asset_status;
DROP POLICY IF EXISTS "ops insert asset_status" ON public.asset_status;
CREATE POLICY "scoped read asset_status" ON public.asset_status FOR SELECT TO authenticated USING (public.can_access_asset(asset_id));
CREATE POLICY "scoped update asset_status" ON public.asset_status FOR UPDATE TO authenticated USING (public.can_access_asset(asset_id)) WITH CHECK (public.can_access_asset(asset_id));
CREATE POLICY "scoped delete asset_status" ON public.asset_status FOR DELETE TO authenticated USING (public.can_access_asset(asset_id));
CREATE POLICY "scoped insert asset_status" ON public.asset_status FOR INSERT TO authenticated WITH CHECK (public.can_access_asset(asset_id));

-- scanner_runs
DROP POLICY IF EXISTS "ops read scanner_runs" ON public.scanner_runs;
DROP POLICY IF EXISTS "ops update scanner_runs" ON public.scanner_runs;
DROP POLICY IF EXISTS "ops delete scanner_runs" ON public.scanner_runs;
DROP POLICY IF EXISTS "ops insert scanner_runs" ON public.scanner_runs;
CREATE POLICY "scoped read scanner_runs" ON public.scanner_runs FOR SELECT TO authenticated USING (
  public.owns_or_is_admin(COALESCE(
    (SELECT ta.created_by FROM public.tracked_accounts ta WHERE ta.id = account_id),
    (SELECT tl.created_by FROM public.tracked_locations tl WHERE tl.id = scanner_runs.location_id),
    created_by, triggered_by))
);
CREATE POLICY "scoped update scanner_runs" ON public.scanner_runs FOR UPDATE TO authenticated USING (public.is_operator(auth.uid())) WITH CHECK (public.is_operator(auth.uid()));
CREATE POLICY "scoped delete scanner_runs" ON public.scanner_runs FOR DELETE TO authenticated USING (
  public.owns_or_is_admin(COALESCE(created_by, triggered_by))
);
CREATE POLICY "scoped insert scanner_runs" ON public.scanner_runs FOR INSERT TO authenticated WITH CHECK (public.is_operator(auth.uid()));

-- watchlists
DROP POLICY IF EXISTS "ops read watchlists" ON public.watchlists;
DROP POLICY IF EXISTS "ops update watchlists" ON public.watchlists;
DROP POLICY IF EXISTS "ops delete watchlists" ON public.watchlists;
DROP POLICY IF EXISTS "ops insert watchlists" ON public.watchlists;
CREATE POLICY "scoped read watchlists" ON public.watchlists FOR SELECT TO authenticated USING (public.owns_or_is_admin(created_by));
CREATE POLICY "scoped update watchlists" ON public.watchlists FOR UPDATE TO authenticated USING (public.owns_or_is_admin(created_by)) WITH CHECK (public.owns_or_is_admin(created_by));
CREATE POLICY "scoped delete watchlists" ON public.watchlists FOR DELETE TO authenticated USING (public.owns_or_is_admin(created_by));
CREATE POLICY "scoped insert watchlists" ON public.watchlists FOR INSERT TO authenticated WITH CHECK (public.is_operator(auth.uid()) AND created_by = auth.uid());

-- watchlist_accounts
DROP POLICY IF EXISTS "ops read watchlist_accounts" ON public.watchlist_accounts;
DROP POLICY IF EXISTS "ops update watchlist_accounts" ON public.watchlist_accounts;
DROP POLICY IF EXISTS "ops delete watchlist_accounts" ON public.watchlist_accounts;
DROP POLICY IF EXISTS "ops insert watchlist_accounts" ON public.watchlist_accounts;
CREATE POLICY "scoped read watchlist_accounts" ON public.watchlist_accounts FOR SELECT TO authenticated USING (
  public.owns_or_is_admin((SELECT w.created_by FROM public.watchlists w WHERE w.id = watchlist_id))
);
CREATE POLICY "scoped update watchlist_accounts" ON public.watchlist_accounts FOR UPDATE TO authenticated USING (
  public.owns_or_is_admin((SELECT w.created_by FROM public.watchlists w WHERE w.id = watchlist_id))
) WITH CHECK (public.is_operator(auth.uid()));
CREATE POLICY "scoped delete watchlist_accounts" ON public.watchlist_accounts FOR DELETE TO authenticated USING (
  public.owns_or_is_admin((SELECT w.created_by FROM public.watchlists w WHERE w.id = watchlist_id))
);
CREATE POLICY "scoped insert watchlist_accounts" ON public.watchlist_accounts FOR INSERT TO authenticated WITH CHECK (
  public.owns_or_is_admin((SELECT w.created_by FROM public.watchlists w WHERE w.id = watchlist_id))
);

-- activity_log
DROP POLICY IF EXISTS "ops read activity_log" ON public.activity_log;
DROP POLICY IF EXISTS "ops insert activity_log" ON public.activity_log;
CREATE POLICY "scoped read activity_log" ON public.activity_log FOR SELECT TO authenticated USING (public.owns_or_is_admin(COALESCE(created_by, actor_id)));
CREATE POLICY "scoped insert activity_log" ON public.activity_log FOR INSERT TO authenticated WITH CHECK (public.is_operator(auth.uid()));
