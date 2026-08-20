-- Phase B: private media packages, manifest metadata and quality checks.
ALTER TABLE public.content_posts
  ADD COLUMN IF NOT EXISTS batch_key uuid,
  ADD COLUMN IF NOT EXISTS manifest_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS content_pillar text NOT NULL DEFAULT 'Product showcase',
  ADD COLUMN IF NOT EXISTS alt_text text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS media_manifest jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS quality_report jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS imported_at timestamptz;

CREATE INDEX IF NOT EXISTS content_posts_batch_idx
  ON public.content_posts (user_id, imported_at DESC)
  WHERE imported_at IS NOT NULL;

-- The browser may create and inspect review packages, but it cannot promote a
-- post by updating its status directly. Approval stays behind the audited RPC.
REVOKE UPDATE ON public.content_posts FROM authenticated;

DROP POLICY IF EXISTS "operators manage own content posts" ON public.content_posts;
DROP POLICY IF EXISTS "operators read own content posts" ON public.content_posts;
CREATE POLICY "operators read own content posts"
  ON public.content_posts FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id AND public.is_operator((SELECT auth.uid())));

DROP POLICY IF EXISTS "operators import own content posts" ON public.content_posts;
CREATE POLICY "operators import own content posts"
  ON public.content_posts FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND public.is_operator((SELECT auth.uid()))
    AND status IN ('draft', 'review')
    AND approved_at IS NULL
    AND approved_by IS NULL
  );

DROP POLICY IF EXISTS "operators delete own content posts" ON public.content_posts;
CREATE POLICY "operators delete own content posts"
  ON public.content_posts FOR DELETE TO authenticated
  USING (
    (SELECT auth.uid()) = user_id
    AND public.is_operator((SELECT auth.uid()))
    AND status NOT IN ('publishing', 'published')
  );

-- The existing ig-publish bucket is private. Operators may only create new
-- files below their own {user_id}/content/ prefix. Upserts stay disabled.
DROP POLICY IF EXISTS "ig-publish owner content insert" ON storage.objects;
CREATE POLICY "ig-publish owner content insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'ig-publish'
    AND (SELECT auth.uid())::text = (storage.foldername(name))[1]
    AND (storage.foldername(name))[2] = 'content'
    AND public.is_operator((SELECT auth.uid()))
  );

-- Allows the importer to remove only its own incomplete content objects after
-- an interrupted package. Existing scanner/download objects are out of scope.
DROP POLICY IF EXISTS "ig-publish owner content cleanup" ON storage.objects;
CREATE POLICY "ig-publish owner content cleanup"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'ig-publish'
    AND (SELECT auth.uid())::text = (storage.foldername(name))[1]
    AND (storage.foldername(name))[2] = 'content'
    AND public.is_operator((SELECT auth.uid()))
  );

-- Approval remains atomic, but now refuses incomplete media packages even if
-- a client-side validation check is bypassed.
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
      ELSE '{}'::jsonb
    END
  );

  IF _decision = 'approved' THEN
    INSERT INTO public.content_publications (content_post_id, channel)
    SELECT _content_post_id, channels.channel
    FROM unnest(ARRAY['reel','feed','story','first_comment']) AS channels(channel)
    ON CONFLICT (content_post_id, channel) DO NOTHING;
  ELSE
    DELETE FROM public.content_publications
    WHERE content_post_id = _content_post_id AND status = 'pending';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION private.review_content_post(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.review_content_post(uuid, text, text) TO authenticated;
