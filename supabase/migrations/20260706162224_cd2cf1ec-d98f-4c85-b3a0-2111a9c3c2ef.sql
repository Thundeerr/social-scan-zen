
ALTER TABLE public.discovery_candidates
  ADD COLUMN IF NOT EXISTS score_reasons jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS headline_signals jsonb NOT NULL DEFAULT '[]'::jsonb;
