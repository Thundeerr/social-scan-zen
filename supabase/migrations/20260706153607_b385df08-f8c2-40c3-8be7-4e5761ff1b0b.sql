
-- 1. tracked_locations table
CREATE TABLE public.tracked_locations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id TEXT NOT NULL,
  name TEXT NOT NULL,
  slug TEXT,
  tier TEXT NOT NULL DEFAULT 'B' CHECK (tier IN ('S','A','B','C')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused')),
  last_scan_at TIMESTAMPTZ,
  next_scan_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  consecutive_failures INT NOT NULL DEFAULT 0,
  last_error TEXT,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (created_by, location_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tracked_locations TO authenticated;
GRANT ALL ON public.tracked_locations TO service_role;

ALTER TABLE public.tracked_locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners manage their locations" ON public.tracked_locations
  FOR ALL USING (auth.uid() = created_by OR public.is_operator(auth.uid()))
  WITH CHECK (auth.uid() = created_by OR public.is_operator(auth.uid()));

CREATE TRIGGER update_tracked_locations_updated_at
  BEFORE UPDATE ON public.tracked_locations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_tracked_locations_next_scan ON public.tracked_locations(status, next_scan_at);
CREATE INDEX idx_tracked_locations_created_by ON public.tracked_locations(created_by);

-- 2. Extend assets
ALTER TABLE public.assets
  ALTER COLUMN account_id DROP NOT NULL,
  ADD COLUMN location_id UUID REFERENCES public.tracked_locations(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX assets_location_external_uniq
  ON public.assets(location_id, external_id)
  WHERE location_id IS NOT NULL;

ALTER TABLE public.assets
  ADD CONSTRAINT assets_source_exactly_one
  CHECK (
    (account_id IS NOT NULL AND location_id IS NULL) OR
    (account_id IS NULL AND location_id IS NOT NULL)
  );

CREATE INDEX idx_assets_location_id ON public.assets(location_id) WHERE location_id IS NOT NULL;

-- 3. Extend scanner_runs
ALTER TABLE public.scanner_runs
  ADD COLUMN location_id UUID REFERENCES public.tracked_locations(id) ON DELETE CASCADE;

CREATE INDEX idx_scanner_runs_location_id ON public.scanner_runs(location_id) WHERE location_id IS NOT NULL;
