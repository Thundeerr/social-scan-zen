ALTER TABLE public.scanner_runs
  ADD COLUMN IF NOT EXISTS assets_duplicates integer NOT NULL DEFAULT 0;