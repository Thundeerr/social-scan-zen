-- Treat a Reel shown in Feed as one publication and keep the Story link as an
-- explicit mobile handoff until Meta exposes link stickers through publishing.
ALTER TABLE public.content_posts
  ADD COLUMN IF NOT EXISTS share_to_feed boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS story_link_url text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS story_link_label text NOT NULL DEFAULT 'Try it now',
  ADD COLUMN IF NOT EXISTS story_publish_mode text NOT NULL DEFAULT 'manual_link_sticker'
    CHECK (story_publish_mode IN ('manual_link_sticker', 'automatic_no_link'));

ALTER TABLE public.content_publications
  ADD COLUMN IF NOT EXISTS depends_on_channel text
    CHECK (depends_on_channel IS NULL OR depends_on_channel IN ('reel'));

ALTER TABLE public.content_posts
  ADD CONSTRAINT content_posts_story_link_url_length_check
    CHECK (char_length(story_link_url) <= 2048),
  ADD CONSTRAINT content_posts_story_link_label_check
    CHECK (
      char_length(story_link_label) BETWEEN 2 AND 50
      AND story_link_label !~ E'[\r\n]'
    );

ALTER TABLE public.content_publications
  DROP CONSTRAINT IF EXISTS content_publications_channel_check;

-- Keep legacy values readable while all new approvals use story_handoff and
-- never create a second Feed publication.
ALTER TABLE public.content_publications
  ADD CONSTRAINT content_publications_channel_check
  CHECK (channel IN ('reel', 'feed', 'story', 'story_handoff', 'first_comment'));

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

  IF _decision = 'approved' AND (
    NULLIF(btrim(_post.caption), '') IS NULL
    OR NULLIF(btrim(_post.cover_storage_path), '') IS NULL
    OR NULLIF(btrim(_post.reel_storage_path), '') IS NULL
    OR NULLIF(btrim(_post.story_storage_path), '') IS NULL
    OR NULLIF(btrim(_post.story_link_label), '') IS NULL
    OR _post.story_publish_mode <> 'manual_link_sticker'
    OR _post.story_link_url !~* '^https://([a-z0-9-]+\.)*followerstar\.com(/|[?#]|$)'
    OR NOT (
      _post.media_manifest @> '{"reel":{"width":1080,"height":1920},"story":{"width":1080,"height":1920}}'::jsonb
    )
    OR jsonb_path_exists(_post.quality_report, '$[*] ? (@.severity == "error")')
  ) THEN
    RAISE EXCEPTION 'Package is incomplete or failed quality checks and cannot be approved';
  END IF;

  UPDATE public.content_posts
  SET status = _decision,
      review_note = CASE WHEN _decision = 'changes_requested' THEN btrim(_note) ELSE NULL END,
      approved_at = CASE WHEN _decision = 'approved' THEN now() ELSE NULL END,
      approved_by = CASE WHEN _decision = 'approved' THEN _actor ELSE NULL END
  WHERE id = _content_post_id;

  INSERT INTO public.content_events (content_post_id, event_type, detail)
  VALUES (
    _content_post_id,
    _decision,
    CASE
      WHEN _decision = 'changes_requested' THEN jsonb_build_object('note', btrim(_note))
      ELSE jsonb_build_object(
        'share_to_feed', _post.share_to_feed,
        'story_publish_mode', _post.story_publish_mode,
        'story_link_host', split_part(split_part(_post.story_link_url, '://', 2), '/', 1)
      )
    END
  );

  IF _decision = 'approved' THEN
    DELETE FROM public.content_publications
    WHERE content_post_id = _content_post_id
      AND status = 'pending'
      AND channel IN ('feed', 'story');

    INSERT INTO public.content_publications (content_post_id, channel, depends_on_channel)
    SELECT _content_post_id, plan.channel, plan.depends_on_channel
    FROM (
      VALUES
        ('reel'::text, NULL::text),
        ('story_handoff'::text, NULL::text),
        ('first_comment'::text, 'reel'::text)
    ) AS plan(channel, depends_on_channel)
    WHERE plan.channel <> 'first_comment' OR NULLIF(btrim(_post.first_comment), '') IS NOT NULL
    ON CONFLICT (content_post_id, channel) DO UPDATE
      SET depends_on_channel = EXCLUDED.depends_on_channel;
  ELSE
    DELETE FROM public.content_publications
    WHERE content_post_id = _content_post_id AND status = 'pending';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION private.review_content_post(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.review_content_post(uuid, text, text) TO authenticated;
