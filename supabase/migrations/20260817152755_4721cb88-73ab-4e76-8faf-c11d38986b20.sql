-- 1) provider_budget_usage: workspace-wide aggregate, now server-only.
REVOKE ALL ON FUNCTION public.provider_budget_usage(timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provider_budget_usage(timestamptz, timestamptz) TO service_role;

-- 2) can_access_asset: no longer needs definer rights; RLS on assets /
-- tracked_accounts / tracked_locations already scopes visibility to the owner,
-- so invoker rights are equally strict (and never broader).
CREATE OR REPLACE FUNCTION public.can_access_asset(_asset_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.assets a
    LEFT JOIN public.tracked_accounts ta ON ta.id = a.account_id
    LEFT JOIN public.tracked_locations tl ON tl.id = a.location_id
    WHERE a.id = _asset_id
      AND public.owns_or_is_admin(COALESCE(ta.created_by, tl.created_by, a.created_by))
  );
$$;

REVOKE ALL ON FUNCTION public.can_access_asset(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_asset(uuid) TO authenticated, service_role;