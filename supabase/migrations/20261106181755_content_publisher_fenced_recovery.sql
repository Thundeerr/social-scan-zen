-- Deploy together with the fenced publisher, while publishing is paused and
-- existing invocations have drained. Old clients fail closed after this migration.
ALTER TABLE public.content_posts
  ADD COLUMN publish_lease_token uuid,
  ADD COLUMN publish_next_attempt_at timestamptz;
ALTER TABLE public.content_publications
  ADD COLUMN external_action_started_at timestamptz,
  ADD COLUMN recovery_required boolean NOT NULL DEFAULT false,
  ADD COLUMN processing_started_at timestamptz;

-- Old workers did not reserve external actions. A legacy container with no
-- media receipt cannot prove that media_publish was never accepted. Quarantine
-- these rows during the paused/drained upgrade, including the historical failed
-- parents. Pending first comments on interrupted posts are ambiguous as well.
UPDATE public.content_publications cp SET recovery_required = true, status = 'failed',
  last_error = 'Legacy Instagram outcome needs reconciliation before retry', updated_at = clock_timestamp()
WHERE cp.platform_media_id IS NULL AND cp.status NOT IN ('published','skipped') AND (
  cp.platform_container_id IS NOT NULL OR (
    cp.channel = 'first_comment' AND EXISTS (
      SELECT 1 FROM public.content_posts p WHERE p.id = cp.content_post_id AND p.status IN ('failed','publishing')
    ) AND EXISTS (
      SELECT 1 FROM public.content_publications primary_pub
      WHERE primary_pub.content_post_id = cp.content_post_id AND primary_pub.channel = 'reel'
        AND primary_pub.status = 'published'
    )
  )
);
INSERT INTO public.content_events(content_post_id,event_type,detail)
SELECT DISTINCT cp.content_post_id, 'legacy_publishing_recovery_required',
  jsonb_build_object('reason','Unfenced legacy send has no durable receipt; reconcile before retry')
FROM public.content_publications cp WHERE cp.recovery_required;
UPDATE public.content_posts p SET status = 'failed',
  last_publish_error = 'Legacy Instagram outcome needs reconciliation before retry',
  publish_lease_until = NULL, updated_at = clock_timestamp()
WHERE p.status IN ('failed','publishing','scheduled') AND EXISTS (
  SELECT 1 FROM public.content_publications cp WHERE cp.content_post_id = p.id AND cp.recovery_required
);

CREATE OR REPLACE FUNCTION public.claim_due_content_post_v2(
  _content_post_id uuid DEFAULT NULL, _user_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE _id uuid; _token uuid := gen_random_uuid();
BEGIN
  SELECT p.id INTO _id FROM public.content_posts p
  WHERE ((p.status = 'scheduled' AND p.scheduled_for <= clock_timestamp()) OR p.status = 'publishing')
    AND (p.publish_lease_until IS NULL OR p.publish_lease_until < clock_timestamp())
    AND (p.publish_next_attempt_at IS NULL OR p.publish_next_attempt_at <= clock_timestamp())
    AND (_content_post_id IS NULL OR p.id = _content_post_id)
    AND (_user_id IS NULL OR p.user_id = _user_id)
    AND NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = p.user_id AND pr.publishing_paused)
    AND NOT EXISTS (SELECT 1 FROM public.content_publications cp WHERE cp.content_post_id = p.id AND cp.recovery_required)
  -- A polling container must not starve another due post.
  ORDER BY COALESCE(p.publish_next_attempt_at, p.scheduled_for, p.created_at), p.created_at, p.id
  FOR UPDATE OF p SKIP LOCKED LIMIT 1;
  IF _id IS NULL THEN RETURN NULL; END IF;
  UPDATE public.content_posts SET status = 'publishing',
    publish_started_at = COALESCE(publish_started_at, clock_timestamp()),
    publish_attempts = CASE WHEN status = 'scheduled' THEN publish_attempts + 1 ELSE publish_attempts END,
    publish_lease_token = _token, publish_lease_until = clock_timestamp() + interval '2 minutes',
    publish_next_attempt_at = NULL, last_publish_error = NULL WHERE id = _id;
  RETURN jsonb_build_object('post_id', _id, 'lease_token', _token);
END $$;

CREATE OR REPLACE FUNCTION public.renew_content_publish_lease(_content_post_id uuid, _lease_token uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE public.content_posts p SET publish_lease_until = clock_timestamp() + interval '2 minutes'
  WHERE p.id = _content_post_id AND p.publish_lease_token = _lease_token
    AND p.status = 'publishing' AND p.publish_lease_until > clock_timestamp()
    AND NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = p.user_id AND pr.publishing_paused);
  RETURN FOUND;
END $$;

-- Lock and check the parent inside the same transaction as every child update.
-- A separate check followed by a REST UPDATE would leave a check/use race.
CREATE OR REPLACE FUNCTION public.write_content_publish_state(
  _content_post_id uuid, _lease_token uuid,
  _publication_id uuid DEFAULT NULL, _publication_values jsonb DEFAULT '{}'::jsonb,
  _post_values jsonb DEFAULT '{}'::jsonb, _event_type text DEFAULT NULL,
  _event_detail jsonb DEFAULT '{}'::jsonb
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE _post public.content_posts%ROWTYPE; _publication public.content_publications%ROWTYPE;
BEGIN
  SELECT * INTO _post FROM public.content_posts WHERE id = _content_post_id FOR UPDATE;
  IF NOT FOUND OR _lease_token IS NULL OR _post.publish_lease_token IS DISTINCT FROM _lease_token
    OR _post.publish_lease_until IS NULL OR _post.publish_lease_until <= clock_timestamp() THEN RETURN false; END IF;
  IF jsonb_typeof(_post_values) IS DISTINCT FROM 'object' OR jsonb_typeof(_publication_values) IS DISTINCT FROM 'object'
    OR EXISTS (SELECT 1 FROM jsonb_object_keys(_post_values) k WHERE k NOT IN
      ('status','published_at','media_cleanup_after','last_publish_error','publish_next_attempt_at'))
    OR EXISTS (SELECT 1 FROM jsonb_object_keys(_publication_values) k WHERE k NOT IN
      ('status','attempts','platform_container_id','platform_child_container_ids','platform_media_id',
       'published_ig_user_id','permalink','published_at','last_error','external_action_started_at',
       'recovery_required','processing_started_at')) THEN RAISE EXCEPTION 'Invalid publisher state patch'; END IF;
  IF _publication_id IS NOT NULL THEN
    SELECT * INTO _publication FROM public.content_publications
      WHERE id = _publication_id AND content_post_id = _content_post_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Publication does not belong to leased post'; END IF;
    _publication := jsonb_populate_record(_publication, _publication_values);
    UPDATE public.content_publications SET status = _publication.status, attempts = _publication.attempts,
      platform_container_id = _publication.platform_container_id,
      platform_child_container_ids = _publication.platform_child_container_ids,
      platform_media_id = _publication.platform_media_id, published_ig_user_id = _publication.published_ig_user_id,
      permalink = _publication.permalink, published_at = _publication.published_at, last_error = _publication.last_error,
      external_action_started_at = _publication.external_action_started_at, recovery_required = _publication.recovery_required,
      processing_started_at = _publication.processing_started_at, updated_at = clock_timestamp()
      WHERE id = _publication_id;
  ELSIF _publication_values <> '{}'::jsonb THEN RAISE EXCEPTION 'Publication id is required'; END IF;
  IF _post_values <> '{}'::jsonb THEN
    _post := jsonb_populate_record(_post, _post_values);
    UPDATE public.content_posts SET status = _post.status, published_at = _post.published_at,
      media_cleanup_after = _post.media_cleanup_after, last_publish_error = _post.last_publish_error,
      publish_next_attempt_at = _post.publish_next_attempt_at, updated_at = clock_timestamp()
      WHERE id = _content_post_id;
  END IF;
  IF _event_type IS NOT NULL THEN
    INSERT INTO public.content_events(content_post_id,event_type,detail)
      VALUES (_content_post_id,_event_type,_event_detail);
  END IF;
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.release_content_publish_lease_v2(_content_post_id uuid, _lease_token uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE public.content_posts SET publish_lease_until = NULL, publish_lease_token = NULL
    WHERE id = _content_post_id AND publish_lease_token = _lease_token;
  RETURN FOUND;
END $$;

-- Prevent manual schedule/retry workflows from clearing an uncertain send.
CREATE OR REPLACE FUNCTION public.guard_content_publish_recovery()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.status = 'scheduled' AND OLD.status IS DISTINCT FROM NEW.status AND EXISTS (
    SELECT 1 FROM public.content_publications cp WHERE cp.content_post_id = NEW.id AND
      (cp.recovery_required OR (cp.external_action_started_at IS NOT NULL AND cp.platform_media_id IS NULL))
  ) THEN RAISE EXCEPTION 'Reconcile the previous Instagram outcome before scheduling this post again'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER content_publish_recovery_guard BEFORE UPDATE OF status ON public.content_posts
FOR EACH ROW EXECUTE FUNCTION public.guard_content_publish_recovery();

CREATE OR REPLACE FUNCTION public.claim_due_content_post(_content_post_id uuid DEFAULT NULL, _user_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN RAISE EXCEPTION 'Publisher upgrade required: use fenced claim v2'; END $$;
CREATE OR REPLACE FUNCTION public.release_content_publish_lease(_content_post_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN RAISE EXCEPTION 'Publisher upgrade required: lease token is required'; END $$;

REVOKE ALL ON FUNCTION public.claim_due_content_post_v2(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.renew_content_publish_lease(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.write_content_publish_state(uuid,uuid,uuid,jsonb,jsonb,text,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.release_content_publish_lease_v2(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.guard_content_publish_recovery() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_content_post_v2(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.renew_content_publish_lease(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.write_content_publish_state(uuid,uuid,uuid,jsonb,jsonb,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_content_publish_lease_v2(uuid,uuid) TO service_role;
