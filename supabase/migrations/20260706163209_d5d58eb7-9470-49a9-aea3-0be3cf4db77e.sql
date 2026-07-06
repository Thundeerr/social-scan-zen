
CREATE TABLE IF NOT EXISTS public.discovery_cooccurrences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  a_id uuid NOT NULL REFERENCES public.discovery_candidates(id) ON DELETE CASCADE,
  b_id uuid NOT NULL REFERENCES public.discovery_candidates(id) ON DELETE CASCADE,
  count integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT discovery_cooccurrences_order_chk CHECK (a_id < b_id),
  CONSTRAINT discovery_cooccurrences_pair_unique UNIQUE (a_id, b_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.discovery_cooccurrences TO authenticated;
GRANT ALL ON public.discovery_cooccurrences TO service_role;

ALTER TABLE public.discovery_cooccurrences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Operators read own cooccurrences"
  ON public.discovery_cooccurrences FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Operators write own cooccurrences"
  ON public.discovery_cooccurrences FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Operators update own cooccurrences"
  ON public.discovery_cooccurrences FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_discovery_cooccurrences_a ON public.discovery_cooccurrences(a_id);
CREATE INDEX IF NOT EXISTS idx_discovery_cooccurrences_b ON public.discovery_cooccurrences(b_id);
CREATE INDEX IF NOT EXISTS idx_discovery_cooccurrences_user ON public.discovery_cooccurrences(user_id);
