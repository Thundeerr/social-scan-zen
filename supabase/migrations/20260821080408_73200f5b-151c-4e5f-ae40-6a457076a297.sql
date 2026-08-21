-- Kill switch is absolute: a paused operator's posts are never claimed.
CREATE OR REPLACE FUNCTION public.claim_due_content_post(
  _content_post_id uuid DEFAULT NULL,
  _user_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _id uuid;
BEGIN
  SELECT p.id INTO _id
  FROM public.content_posts p
  WHERE (
      (p.status = 'scheduled' AND p.scheduled_for <= now())
      OR p.status = 'publishing'
    )
    AND (p.publish_lease_until IS NULL OR p.publish_lease_until < now())
    AND (_content_post_id IS NULL OR p.id = _content_post_id)
    AND (_user_id IS NULL OR p.user_id = _user_id)
    AND NOT EXISTS (
      SELECT 1 FROM public.profiles pr
      WHERE pr.id = p.user_id AND pr.publishing_paused
    )
  ORDER BY
    CASE WHEN p.status = 'publishing' THEN 0 ELSE 1 END,
    p.scheduled_for NULLS LAST,
    p.created_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF _id IS NULL THEN RETURN NULL; END IF;

  UPDATE public.content_posts
  SET status = 'publishing',
      publish_started_at = COALESCE(publish_started_at, now()),
      publish_attempts = CASE WHEN status = 'scheduled' THEN publish_attempts + 1 ELSE publish_attempts END,
      publish_lease_until = now() + interval '2 minutes',
      last_publish_error = NULL
  WHERE id = _id;

  RETURN _id;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_due_content_post(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_content_post(uuid, uuid) TO service_role;

-- Vault secret for the pg_cron header (value generated in-database, never logged).
SELECT vault.create_secret(
  encode(gen_random_bytes(32), 'hex'),
  'CRON_SECRET',
  'pg_cron header for the content-publisher worker'
)
WHERE NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'CRON_SECRET');

-- Publishing stays paused until an operator deliberately resumes it.
UPDATE public.profiles SET publishing_paused = true WHERE publishing_paused IS DISTINCT FROM true;