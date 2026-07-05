ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS last_seen_at timestamp with time zone NOT NULL DEFAULT now();
UPDATE public.assets SET last_seen_at = detected_at WHERE last_seen_at = created_at;
CREATE INDEX IF NOT EXISTS assets_last_seen_idx ON public.assets (last_seen_at DESC);