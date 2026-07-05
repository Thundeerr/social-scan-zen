
ALTER FUNCTION public.is_operator(uuid) SECURITY INVOKER;
ALTER FUNCTION public.has_role(uuid, public.app_role) SECURITY INVOKER;
GRANT EXECUTE ON FUNCTION public.is_operator(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
