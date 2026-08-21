-- Autonomous FollowerStar content publishing.
-- Media remains private in ig-publish. The worker creates short-lived signed
-- URLs only while Meta is ingesting a Reel or Story, then removes video
-- objects 48 hours after every automatic channel is complete.

ALTER TABLE public.content_posts
  ADD COLUMN IF NOT EXISTS publish_attempts integer NOT NULL DEFAULT 0
    CHECK (publish_attempts BETWEEN 0 AND 10),
  ADD COLUMN IF NOT EXISTS publish_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS publish_lease_until timestamptz,
  ADD COLUMN IF NOT EXISTS published_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_publish_error text,
  ADD COLUMN IF NOT EXISTS media_cleanup_after timestamptz,
  ADD COLUMN IF NOT EXISTS media_cleaned_at timestamptz,
  ADD COLUMN IF NOT EXISTS highlight_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS highlight_name text NOT NULL DEFAULT 'Free Tools'
    CHECK (char_length(highlight_name) BETWEEN 1 AND 30 AND highlight_name !~ E'[\r\n]');

ALTER TABLE public.content_publications
  DROP CONSTRAINT IF EXISTS content_publications_channel_check;
ALTER TABLE public.content_publications
  ADD CONSTRAINT content_publications_channel_check
  CHECK (channel IN (
    'reel', 'feed', 'story', 'story_handoff', 'highlight_handoff', 'first_comment'
  ));

ALTER TABLE public.content_publications
  DROP CONSTRAINT IF EXISTS content_publications_depends_on_channel_check;
ALTER TABLE public.content_publications
  ADD CONSTRAINT content_publications_depends_on_channel_check
  CHECK (depends_on_channel IS NULL OR depends_on_channel IN ('reel', 'story', 'story_handoff'));

CREATE INDEX IF NOT EXISTS content_posts_publish_worker_idx
  ON public.content_posts (status, scheduled_for, publish_lease_until)
  WHERE status IN ('scheduled', 'publishing');

CREATE INDEX IF NOT EXISTS content_posts_media_cleanup_idx
  ON public.content_posts (media_cleanup_after)
  WHERE media_cleanup_after IS NOT NULL AND media_cleaned_at IS NULL;

-- Existing connections were created for the Facebook Graph host. New
-- Instagram Login connections can explicitly select graph.instagram.com.
ALTER TABLE public.ig_connections
  ADD COLUMN IF NOT EXISTS api_base_url text NOT NULL
    DEFAULT 'https://graph.facebook.com/v25.0'
    CHECK (api_base_url IN (
      'https://graph.facebook.com/v25.0',
      'https://graph.instagram.com/v25.0'
    ));

-- Approval now supports either a fully automatic Story without a link sticker
-- or the existing manual link-sticker handoff. A Feed publication is never
-- created separately; share_to_feed is a property of the Reel container.
CREATE OR REPLACE FUNCTION private.review_content_post(
  _content_post_id uuid,
  _decision text,
  _note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _actor uuid := auth.uid();
  _post public.content_posts%ROWTYPE;
BEGIN
  IF _actor IS NULL OR NOT public.is_operator(_actor) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF _decision NOT IN ('approved', 'changes_requested') THEN
    RAISE EXCEPTION 'Invalid review decision';
  END IF;
  IF _decision = 'changes_requested' AND NULLIF(btrim(_note), '') IS NULL THEN
    RAISE EXCEPTION 'A review note is required';
  END IF;

  SELECT * INTO _post
  FROM public.content_posts
  WHERE id = _content_post_id
  FOR UPDATE;

  IF _post.id IS NULL OR _post.user_id <> _actor THEN
    RAISE EXCEPTION 'Content post not found';
  END IF;
  IF _post.status NOT IN ('review', 'changes_requested') THEN
    RAISE EXCEPTION 'Only posts in review can receive a review decision';
  END IF;

  IF _decision = 'approved' AND (
    NULLIF(btrim(_post.caption), '') IS NULL
    OR NULLIF(btrim(_post.cover_storage_path), '') IS NULL
    OR NULLIF(btrim(_post.reel_storage_path), '') IS NULL
    OR NULLIF(btrim(_post.story_storage_path), '') IS NULL
    OR NOT (
      _post.media_manifest @> '{"reel":{"width":1080,"height":1920},"story":{"width":1080,"height":1920}}'::jsonb
    )
    OR jsonb_path_exists(_post.quality_report, '$[*] ? (@.severity == "error")')
    OR (
      _post.story_publish_mode = 'manual_link_sticker'
      AND (
        NULLIF(btrim(_post.story_link_label), '') IS NULL
        OR _post.story_link_url !~* '^https://([a-z0-9-]+\.)*followerstar\.com(/|[?#]|$)'
      )
    )
  ) THEN
    RAISE EXCEPTION 'Package is incomplete or failed quality checks and cannot be approved';
  END IF;

  UPDATE public.content_posts
  SET status = _decision,
      review_note = CASE WHEN _decision = 'changes_requested' THEN btrim(_note) ELSE NULL END,
      approved_at = CASE WHEN _decision = 'approved' THEN now() ELSE NULL END,
      approved_by = CASE WHEN _decision = 'approved' THEN _actor ELSE NULL END,
      scheduled_for = CASE WHEN _decision = 'approved' THEN NULL ELSE scheduled_for END,
      last_publish_error = NULL
  WHERE id = _content_post_id;

  INSERT INTO public.content_events (content_post_id, event_type, detail)
  VALUES (
    _content_post_id,
    _decision,
    CASE
      WHEN _decision = 'changes_requested' THEN jsonb_build_object('note', btrim(_note))
      ELSE jsonb_build_object(
        'share_to_feed', _post.share_to_feed,
        'story_publish_mode', _post.story_publish_mode
      )
    END
  );

  IF _decision = 'approved' THEN
    DELETE FROM public.content_publications
    WHERE content_post_id = _content_post_id
      AND status IN ('pending', 'failed');

    INSERT INTO public.content_publications (content_post_id, channel, depends_on_channel)
    SELECT _content_post_id, plan.channel, plan.depends_on_channel
    FROM (
      VALUES
        ('reel'::text, NULL::text),
        (
          CASE WHEN _post.story_publish_mode = 'automatic_no_link'
            THEN 'story' ELSE 'story_handoff' END,
          NULL::text
        ),
        (
          'highlight_handoff'::text,
          CASE WHEN _post.story_publish_mode = 'automatic_no_link'
            THEN 'story' ELSE 'story_handoff' END
        ),
        ('first_comment'::text, 'reel'::text)
    ) AS plan(channel, depends_on_channel)
    WHERE (plan.channel <> 'first_comment' OR NULLIF(btrim(_post.first_comment), '') IS NOT NULL)
      AND (plan.channel <> 'highlight_handoff' OR _post.highlight_enabled)
    ON CONFLICT (content_post_id, channel) DO UPDATE
      SET depends_on_channel = EXCLUDED.depends_on_channel,
          status = CASE
            WHEN content_publications.status = 'published' THEN 'published'
            ELSE 'pending'
          END,
          last_error = NULL;
  ELSE
    DELETE FROM public.content_publications
    WHERE content_post_id = _content_post_id AND status IN ('pending', 'failed');
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION private.review_content_post(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.review_content_post(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION private.schedule_content_post(
  _content_post_id uuid,
  _scheduled_for timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _actor uuid := auth.uid();
  _post public.content_posts%ROWTYPE;
BEGIN
  IF _actor IS NULL OR NOT public.is_operator(_actor) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF _scheduled_for < now() - interval '1 minute'
     OR _scheduled_for > now() + interval '1 year' THEN
    RAISE EXCEPTION 'Publishing time is outside the allowed range';
  END IF;

  SELECT * INTO _post
  FROM public.content_posts
  WHERE id = _content_post_id
  FOR UPDATE;

  IF _post.id IS NULL OR _post.user_id <> _actor THEN
    RAISE EXCEPTION 'Content post not found';
  END IF;
  IF _post.status NOT IN ('approved', 'scheduled', 'failed') THEN
    RAISE EXCEPTION 'Only approved, scheduled or failed posts can be scheduled';
  END IF;
  IF _post.publish_attempts >= 10 THEN
    RAISE EXCEPTION 'Publishing retry limit reached';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.ig_connections
    WHERE user_id = _actor
      AND status = 'active'
      -- Do not accept a future schedule which is already known to outlive
      -- its credential. Keep a six-hour buffer for Meta processing/retries.
      AND token_expires_at > GREATEST(_scheduled_for, now()) + interval '6 hours'
  ) THEN
    RAISE EXCEPTION 'Instagram must stay connected until at least six hours after publishing';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = _actor AND publishing_paused
  ) THEN
    RAISE EXCEPTION 'Publishing is paused in Settings';
  END IF;

  UPDATE public.content_publications
  SET status = 'pending', last_error = NULL
  WHERE content_post_id = _content_post_id AND status = 'failed';

  UPDATE public.content_posts
  SET status = 'scheduled',
      scheduled_for = GREATEST(_scheduled_for, now()),
      publish_started_at = NULL,
      publish_lease_until = NULL,
      last_publish_error = NULL
  WHERE id = _content_post_id;

  INSERT INTO public.content_events (content_post_id, event_type, detail)
  VALUES (
    _content_post_id,
    'scheduled',
    jsonb_build_object('scheduled_for', GREATEST(_scheduled_for, now()))
  );
END;
$$;

REVOKE ALL ON FUNCTION private.schedule_content_post(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.schedule_content_post(uuid, timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION public.schedule_content_post(
  _content_post_id uuid,
  _scheduled_for timestamptz
)
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, private, pg_temp
AS $$
  SELECT private.schedule_content_post(_content_post_id, _scheduled_for);
$$;

REVOKE ALL ON FUNCTION public.schedule_content_post(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.schedule_content_post(uuid, timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION private.confirm_content_handoff(
  _content_post_id uuid,
  _channel text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _actor uuid := auth.uid();
  _publication public.content_publications%ROWTYPE;
BEGIN
  IF _actor IS NULL OR NOT public.is_operator(_actor) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF _channel NOT IN ('story_handoff', 'highlight_handoff') THEN
    RAISE EXCEPTION 'Invalid handoff channel';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.content_posts
    WHERE id = _content_post_id AND user_id = _actor
  ) THEN
    RAISE EXCEPTION 'Content post not found';
  END IF;

  SELECT * INTO _publication
  FROM public.content_publications
  WHERE content_post_id = _content_post_id AND channel = _channel
  FOR UPDATE;

  IF _publication.id IS NULL THEN
    RAISE EXCEPTION 'Handoff step not found';
  END IF;
  IF _publication.status = 'published' THEN
    RETURN;
  END IF;
  IF _publication.status <> 'pending' THEN
    RAISE EXCEPTION 'Handoff step is not ready for confirmation';
  END IF;
  IF _publication.depends_on_channel IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.content_publications dependency
    WHERE dependency.content_post_id = _content_post_id
      AND dependency.channel = _publication.depends_on_channel
      AND dependency.status = 'published'
  ) THEN
    RAISE EXCEPTION 'The preceding Story step is not complete';
  END IF;
  IF _channel = 'story_handoff' AND NOT EXISTS (
    SELECT 1
    FROM public.content_publications reel
    WHERE reel.content_post_id = _content_post_id
      AND reel.channel = 'reel'
      AND reel.status = 'published'
  ) THEN
    RAISE EXCEPTION 'The Reel must be published first';
  END IF;

  UPDATE public.content_publications
  SET status = 'published', published_at = now(), last_error = NULL
  WHERE content_post_id = _content_post_id AND channel = _channel;

  IF _channel = 'story_handoff' THEN
    UPDATE public.content_posts
    SET media_cleanup_after = COALESCE(media_cleanup_after, now() + interval '48 hours')
    WHERE id = _content_post_id;
  END IF;

  INSERT INTO public.content_events (content_post_id, event_type, detail)
  VALUES (_content_post_id, _channel || '_confirmed', '{}'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION private.confirm_content_handoff(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.confirm_content_handoff(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.confirm_content_handoff(
  _content_post_id uuid,
  _channel text
)
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, private, pg_temp
AS $$
  SELECT private.confirm_content_handoff(_content_post_id, _channel);
$$;

REVOKE ALL ON FUNCTION public.confirm_content_handoff(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_content_handoff(uuid, text) TO authenticated;

-- Atomic worker lease. Calling the worker twice cannot create two containers.
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
  SELECT id INTO _id
  FROM public.content_posts
  WHERE (
      (status = 'scheduled' AND scheduled_for <= now())
      OR status = 'publishing'
    )
    AND (publish_lease_until IS NULL OR publish_lease_until < now())
    AND (_content_post_id IS NULL OR id = _content_post_id)
    AND (_user_id IS NULL OR user_id = _user_id)
  ORDER BY
    CASE WHEN status = 'publishing' THEN 0 ELSE 1 END,
    scheduled_for NULLS LAST,
    created_at
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

CREATE OR REPLACE FUNCTION public.release_content_publish_lease(_content_post_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE public.content_posts
  SET publish_lease_until = NULL
  WHERE id = _content_post_id;
$$;

REVOKE ALL ON FUNCTION public.release_content_publish_lease(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_content_publish_lease(uuid) TO service_role;

-- The Edge Function uses this narrow boolean check for pg_cron's header. The
-- Vault secret is never returned through the Data API.
CREATE OR REPLACE FUNCTION public.verify_publisher_cron_secret(_candidate text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, vault, pg_temp
AS $$
  SELECT COALESCE(
    EXISTS (
      SELECT 1
      FROM vault.decrypted_secrets
      WHERE name = 'CRON_SECRET'
        AND decrypted_secret = _candidate
    ),
    false
  );
$$;

REVOKE ALL ON FUNCTION public.verify_publisher_cron_secret(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_publisher_cron_secret(text) TO service_role;

-- Replace any earlier copy without touching unrelated cron jobs.
DO $$
DECLARE _job_id bigint;
BEGIN
  SELECT jobid INTO _job_id FROM cron.job
  WHERE jobname = 'instascanner-content-publisher-every-minute';
  IF _job_id IS NOT NULL THEN PERFORM cron.unschedule(_job_id); END IF;
END $$;

SELECT cron.schedule(
  'instascanner-content-publisher-every-minute',
  '* * * * *',
  $cron$
    SELECT net.http_post(
      url := 'https://vkudzmoaqskmglfajzkz.supabase.co/functions/v1/content-publisher',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (
          SELECT decrypted_secret
          FROM vault.decrypted_secrets
          WHERE name = 'CRON_SECRET'
          LIMIT 1
        )
      ),
      body := '{"source":"pg_cron"}'::jsonb,
      -- A single Meta request may take 20 seconds and a worker tick can make
      -- more than one. Do not let pg_net abort a healthy run prematurely.
      timeout_milliseconds := 60000
    );
  $cron$
);
