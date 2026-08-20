-- FollowerStar-owned content queue. This is separate from publish_jobs, which
-- represents reposting an asset detected by the scanner.
CREATE TABLE public.content_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  post_key text NOT NULL,
  title text NOT NULL,
  hook text NOT NULL DEFAULT '',
  caption text NOT NULL DEFAULT '',
  first_comment text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','review','changes_requested','approved','scheduled','publishing','published','failed')),
  scheduled_for timestamptz,
  cover_storage_path text,
  reel_storage_path text,
  story_storage_path text,
  media_sha256 text,
  review_note text,
  approved_at timestamptz,
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, post_key)
);

CREATE INDEX content_posts_queue_idx
  ON public.content_posts (user_id, status, scheduled_for);

CREATE UNIQUE INDEX content_posts_media_sha256_unique
  ON public.content_posts (user_id, media_sha256)
  WHERE media_sha256 IS NOT NULL;

CREATE TABLE public.content_publications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_post_id uuid NOT NULL REFERENCES public.content_posts(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('reel','feed','story','first_comment')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','publishing','published','skipped','failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  platform_media_id text,
  permalink text,
  last_error text,
  platform_container_id text,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (content_post_id, channel)
);

CREATE INDEX content_publications_status_idx
  ON public.content_publications (status, created_at);

CREATE TABLE public.content_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_post_id uuid NOT NULL REFERENCES public.content_posts(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX content_events_post_idx
  ON public.content_events (content_post_id, created_at DESC);

REVOKE ALL ON public.content_posts, public.content_publications, public.content_events FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.content_posts TO authenticated;
GRANT SELECT ON public.content_publications, public.content_events TO authenticated;
GRANT ALL ON public.content_posts, public.content_publications, public.content_events TO service_role;

ALTER TABLE public.content_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "operators manage own content posts"
  ON public.content_posts FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id AND public.is_operator((SELECT auth.uid())))
  WITH CHECK ((SELECT auth.uid()) = user_id AND public.is_operator((SELECT auth.uid())));

CREATE POLICY "operators manage own content publications"
  ON public.content_publications FOR SELECT TO authenticated
  USING (
    public.is_operator((SELECT auth.uid()))
    AND EXISTS (
      SELECT 1 FROM public.content_posts
      WHERE content_posts.id = content_publications.content_post_id
        AND content_posts.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "operators read own content events"
  ON public.content_events FOR SELECT TO authenticated
  USING (
    public.is_operator((SELECT auth.uid()))
    AND EXISTS (
      SELECT 1 FROM public.content_posts
      WHERE content_posts.id = content_events.content_post_id
        AND content_posts.user_id = (SELECT auth.uid())
    )
  );

CREATE TRIGGER content_posts_updated_at
  BEFORE UPDATE ON public.content_posts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER content_publications_updated_at
  BEFORE UPDATE ON public.content_publications
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Keep editorial decisions, their audit event and channel rows atomic. The
-- browser can execute this narrow operation but cannot write audit/publication
-- rows directly.
CREATE OR REPLACE FUNCTION public.review_content_post(
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
  _owner uuid;
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

  SELECT user_id INTO _owner
  FROM public.content_posts
  WHERE id = _content_post_id
  FOR UPDATE;

  IF _owner IS NULL OR _owner <> _actor THEN
    RAISE EXCEPTION 'Content post not found';
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

REVOKE ALL ON FUNCTION public.review_content_post(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_content_post(uuid, text, text) TO authenticated;

-- Access tokens must never be selectable through a browser client. RLS limits
-- rows, not columns, so replace the previous table-wide SELECT grant.
REVOKE ALL ON public.ig_connections FROM anon, authenticated;
GRANT SELECT (
  id, user_id, ig_user_id, ig_username, page_id, token_expires_at,
  status, last_error, created_at, updated_at
) ON public.ig_connections TO authenticated;
