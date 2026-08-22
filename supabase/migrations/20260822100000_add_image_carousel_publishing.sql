-- Add first-class feed images and Instagram carousels while keeping the
-- existing Reel queue and publication channels backwards compatible.
ALTER TABLE public.content_posts
  ADD COLUMN IF NOT EXISTS content_type text NOT NULL DEFAULT 'reel',
  ADD COLUMN IF NOT EXISTS planned_for timestamptz,
  ADD COLUMN IF NOT EXISTS primary_media_storage_paths text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS primary_media_alt_texts text[] NOT NULL DEFAULT '{}'::text[];

ALTER TABLE public.content_publications
  ADD COLUMN IF NOT EXISTS platform_child_container_ids text[] NOT NULL DEFAULT '{}'::text[];

ALTER TABLE public.content_posts
  DROP CONSTRAINT IF EXISTS content_posts_content_type_check;
ALTER TABLE public.content_posts
  ADD CONSTRAINT content_posts_content_type_check
  CHECK (content_type IN ('reel', 'image', 'carousel'));

ALTER TABLE public.content_posts
  DROP CONSTRAINT IF EXISTS content_posts_primary_media_count_check;
ALTER TABLE public.content_posts
  ADD CONSTRAINT content_posts_primary_media_count_check
  CHECK (
    (content_type = 'reel' AND cardinality(primary_media_storage_paths) IN (0, 1))
    OR (content_type = 'image' AND cardinality(primary_media_storage_paths) = 1)
    OR (content_type = 'carousel' AND cardinality(primary_media_storage_paths) BETWEEN 2 AND 10)
  );

ALTER TABLE public.content_posts
  DROP CONSTRAINT IF EXISTS content_posts_primary_alt_count_check;
ALTER TABLE public.content_posts
  ADD CONSTRAINT content_posts_primary_alt_count_check
  CHECK (
    cardinality(primary_media_alt_texts) = 0
    OR cardinality(primary_media_alt_texts) = cardinality(primary_media_storage_paths)
  );

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
  _primary_count integer;
  _manifest_primary_count integer;
  _invalid_primary_count integer;
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

  _primary_count := cardinality(_post.primary_media_storage_paths);
  SELECT
    count(*),
    count(*) FILTER (
      WHERE (entry.value ->> 'contentType') IS DISTINCT FROM 'image/jpeg'
        OR (entry.value -> 'width') IS DISTINCT FROM '1080'::jsonb
        OR (entry.value -> 'height') IS DISTINCT FROM '1350'::jsonb
    )
  INTO _manifest_primary_count, _invalid_primary_count
  FROM jsonb_each(_post.media_manifest) AS entry
  WHERE entry.key = 'image' OR entry.key ~ '^slide_[0-9]+$';

  IF _decision = 'approved' AND (
    NULLIF(btrim(_post.caption), '') IS NULL
    OR NULLIF(btrim(_post.cover_storage_path), '') IS NULL
    OR NULLIF(btrim(_post.story_storage_path), '') IS NULL
    OR NOT (_post.media_manifest @> '{"story":{"width":1080,"height":1920}}'::jsonb)
    OR jsonb_path_exists(_post.quality_report, '$[*] ? (@.severity == "error")')
    OR (
      _post.content_type = 'reel'
      AND (
        NULLIF(btrim(_post.reel_storage_path), '') IS NULL
        OR NOT (_post.media_manifest @> '{"reel":{"width":1080,"height":1920}}'::jsonb)
      )
    )
    OR (_post.content_type = 'image' AND _primary_count <> 1)
    OR (_post.content_type = 'carousel' AND _primary_count NOT BETWEEN 2 AND 10)
    OR (
      _post.content_type IN ('image', 'carousel')
      AND (
        _manifest_primary_count <> _primary_count
        OR _invalid_primary_count > 0
      )
    )
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
        'content_type', _post.content_type,
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

CREATE OR REPLACE FUNCTION public.approve_content_batch(_batch_key uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _actor uuid := auth.uid();
  _post record;
  _count integer := 0;
BEGIN
  IF _actor IS NULL OR NOT public.is_operator(_actor) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF _batch_key IS NULL THEN
    RAISE EXCEPTION 'Batch is required';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = _actor AND publishing_paused = true
  ) THEN
    RAISE EXCEPTION 'Publishing is paused. Resume cloud publishing before approving the batch.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.content_posts
    WHERE user_id = _actor AND batch_key = _batch_key AND status = 'review'
  ) THEN
    RAISE EXCEPTION 'This batch has no posts waiting for review';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.content_posts
    WHERE user_id = _actor
      AND batch_key = _batch_key
      AND status = 'review'
      AND (planned_for IS NULL OR planned_for <= now() + interval '1 minute')
  ) THEN
    RAISE EXCEPTION 'Every post needs a future built-in publishing time';
  END IF;
  IF (
    SELECT count(*) FROM public.content_posts
    WHERE user_id = _actor AND batch_key = _batch_key AND status = 'review'
  ) <> (
    SELECT count(DISTINCT planned_for) FROM public.content_posts
    WHERE user_id = _actor AND batch_key = _batch_key AND status = 'review'
  ) THEN
    RAISE EXCEPTION 'Built-in publishing times must be unique within a batch';
  END IF;

  FOR _post IN
    SELECT id, planned_for
    FROM public.content_posts
    WHERE user_id = _actor AND batch_key = _batch_key AND status = 'review'
    ORDER BY planned_for, id
    FOR UPDATE
  LOOP
    PERFORM private.review_content_post(_post.id, 'approved', NULL);
    PERFORM private.schedule_content_post(_post.id, _post.planned_for);
    _count := _count + 1;
  END LOOP;

  RETURN _count;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_content_batch(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_content_batch(uuid) TO authenticated;
