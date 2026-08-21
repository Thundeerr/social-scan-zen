-- Controlled smoke test: unpause publishing only for the operator that owns the
-- active Instagram connection @followerstarteam. No other profile is touched.
UPDATE public.profiles p
SET publishing_paused = false
WHERE p.publishing_paused
  AND EXISTS (
    SELECT 1 FROM public.ig_connections c
    WHERE c.user_id = p.id
      AND c.status = 'active'
      AND c.ig_username = 'followerstarteam'
  );