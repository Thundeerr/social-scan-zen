
CREATE OR REPLACE FUNCTION public.provider_budget_usage(_start timestamptz, _end timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  result jsonb;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_operator(auth.uid()) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  WITH runs AS (
    SELECT
      r.created_at,
      COALESCE(
        r.created_by,
        r.triggered_by,
        (SELECT ta.created_by FROM public.tracked_accounts ta WHERE ta.id = r.account_id),
        (SELECT tl.created_by FROM public.tracked_locations tl WHERE tl.id = r.location_id)
      ) AS owner_id
    FROM public.scanner_runs r
    WHERE r.created_at >= _start AND r.created_at < _end
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM runs),
    'last_24h', (SELECT count(*) FROM runs WHERE created_at >= now() - interval '24 hours'),
    'last_7d', (SELECT count(*) FROM runs WHERE created_at >= now() - interval '7 days'),
    'by_operator', COALESCE((
      SELECT jsonb_agg(x ORDER BY (x->>'used')::int DESC)
      FROM (
        SELECT jsonb_build_object(
          'user_id', runs.owner_id,
          'name', COALESCE(p.display_name, split_part(p.email, '@', 1), 'Unassigned'),
          'used', count(*)
        ) AS x
        FROM runs
        LEFT JOIN public.profiles p ON p.id = runs.owner_id
        GROUP BY runs.owner_id, p.display_name, p.email
      ) s
    ), '[]'::jsonb)
  ) INTO result;

  RETURN result;
END;
$$;
