
-- Enums
DO $$ BEGIN
  CREATE TYPE public.discovery_state AS ENUM ('new','tracked','ignored','blacklisted');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.discovery_source_type AS ENUM (
    'tagged_collaborator','tagged_user','co_appearance',
    'location_cooccurrence','hashtag_cooccurrence','account_mention',
    'provider_recommendation'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Track how a tracked_account was created (manual vs discovery)
ALTER TABLE public.tracked_accounts
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS last_discovery_at timestamptz;

ALTER TABLE public.tracked_locations
  ADD COLUMN IF NOT EXISTS last_discovery_at timestamptz;

-- Candidates
CREATE TABLE IF NOT EXISTS public.discovery_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  username text NOT NULL,
  full_name text,
  avatar_url text,
  followers integer,
  following integer,
  posts_count integer,
  is_private boolean,
  is_verified boolean,
  estimated_niche text,
  ai_summary text,
  luxury_score integer,
  quality_score integer,
  aesthetic_score integer,
  travel_score integer,
  authenticity_score integer,
  p_private_individual numeric,
  p_commercial_brand numeric,
  estimated_post_frequency text,
  confidence numeric NOT NULL DEFAULT 0,
  rank_score numeric NOT NULL DEFAULT 0,
  state public.discovery_state NOT NULL DEFAULT 'new',
  signal_count integer NOT NULL DEFAULT 0,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  last_ai_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, username)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.discovery_candidates TO authenticated;
GRANT ALL ON public.discovery_candidates TO service_role;
ALTER TABLE public.discovery_candidates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own candidates select" ON public.discovery_candidates
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own candidates insert" ON public.discovery_candidates
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own candidates update" ON public.discovery_candidates
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own candidates delete" ON public.discovery_candidates
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS discovery_candidates_user_state_rank_idx
  ON public.discovery_candidates (user_id, state, rank_score DESC);
CREATE INDEX IF NOT EXISTS discovery_candidates_user_ai_idx
  ON public.discovery_candidates (user_id, last_ai_at NULLS FIRST);

CREATE TRIGGER trg_discovery_candidates_updated_at
  BEFORE UPDATE ON public.discovery_candidates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Signals
CREATE TABLE IF NOT EXISTS public.discovery_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES public.discovery_candidates(id) ON DELETE CASCADE,
  username text NOT NULL,
  source_type public.discovery_source_type NOT NULL,
  seed_account_id uuid REFERENCES public.tracked_accounts(id) ON DELETE SET NULL,
  seed_location_id uuid REFERENCES public.tracked_locations(id) ON DELETE SET NULL,
  seed_hashtag text,
  weight numeric NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.discovery_signals TO authenticated;
GRANT ALL ON public.discovery_signals TO service_role;
ALTER TABLE public.discovery_signals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own signals select" ON public.discovery_signals
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own signals insert" ON public.discovery_signals
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own signals delete" ON public.discovery_signals
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS discovery_signals_candidate_idx
  ON public.discovery_signals (candidate_id, created_at DESC);

-- Blacklist
CREATE TABLE IF NOT EXISTS public.discovery_blacklist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  username text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, username)
);

GRANT SELECT, INSERT, DELETE ON public.discovery_blacklist TO authenticated;
GRANT ALL ON public.discovery_blacklist TO service_role;
ALTER TABLE public.discovery_blacklist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own blacklist all" ON public.discovery_blacklist
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Preferences (learning vector)
CREATE TABLE IF NOT EXISTS public.discovery_preferences (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  avg_luxury numeric NOT NULL DEFAULT 50,
  avg_quality numeric NOT NULL DEFAULT 50,
  avg_aesthetic numeric NOT NULL DEFAULT 50,
  avg_travel numeric NOT NULL DEFAULT 50,
  avg_authenticity numeric NOT NULL DEFAULT 50,
  pref_private numeric NOT NULL DEFAULT 0.5,
  pref_commercial numeric NOT NULL DEFAULT 0.5,
  niche_weights jsonb NOT NULL DEFAULT '{}'::jsonb,
  signal_weights jsonb NOT NULL DEFAULT '{}'::jsonb,
  sample_size integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.discovery_preferences TO authenticated;
GRANT ALL ON public.discovery_preferences TO service_role;
ALTER TABLE public.discovery_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own prefs all" ON public.discovery_preferences
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER trg_discovery_preferences_updated_at
  BEFORE UPDATE ON public.discovery_preferences
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Trigger: when a candidate is set to 'tracked', promote to tracked_accounts
CREATE OR REPLACE FUNCTION public.promote_discovery_to_tracked()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.state = 'tracked' AND (OLD.state IS DISTINCT FROM 'tracked') THEN
    INSERT INTO public.tracked_accounts (
      username, display_name, avatar_url, status, tier, created_by, source
    ) VALUES (
      NEW.username,
      COALESCE(NEW.full_name, NEW.username),
      NEW.avatar_url,
      'active',
      'B',
      NEW.user_id,
      'discovery'
    )
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_promote_discovery ON public.discovery_candidates;
CREATE TRIGGER trg_promote_discovery
  AFTER UPDATE OF state ON public.discovery_candidates
  FOR EACH ROW EXECUTE FUNCTION public.promote_discovery_to_tracked();
