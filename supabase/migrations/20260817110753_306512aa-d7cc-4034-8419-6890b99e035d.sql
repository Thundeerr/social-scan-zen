REVOKE ALL ON FUNCTION public.can_access_asset(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_asset(uuid) TO authenticated, service_role;