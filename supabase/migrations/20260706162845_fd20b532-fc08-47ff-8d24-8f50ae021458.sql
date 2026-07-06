
ALTER TABLE public.discovery_candidates
  ADD COLUMN IF NOT EXISTS parent_candidate_id uuid NULL REFERENCES public.discovery_candidates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS depth integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_discovery_candidates_parent ON public.discovery_candidates(parent_candidate_id);

ALTER TABLE public.tracked_accounts
  ADD COLUMN IF NOT EXISTS origin_candidate_id uuid NULL REFERENCES public.discovery_candidates(id) ON DELETE SET NULL;

-- Extend the promotion trigger to remember which candidate produced the tracked account.
CREATE OR REPLACE FUNCTION public.promote_discovery_to_tracked()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.state = 'tracked' AND (OLD.state IS DISTINCT FROM 'tracked') THEN
    INSERT INTO public.tracked_accounts (
      username, display_name, avatar_url, status, tier, created_by, source, origin_candidate_id
    ) VALUES (
      NEW.username,
      COALESCE(NEW.full_name, NEW.username),
      NEW.avatar_url,
      'active',
      'B',
      NEW.user_id,
      'discovery',
      NEW.id
    )
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$function$;
