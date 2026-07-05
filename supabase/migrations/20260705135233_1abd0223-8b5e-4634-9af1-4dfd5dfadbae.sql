
CREATE TABLE public.asset_downloads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  downloaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  downloaded_at timestamptz NOT NULL DEFAULT now(),
  media_url text,
  media_type text,
  filename text,
  file_size bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX asset_downloads_asset_idx ON public.asset_downloads(asset_id);
CREATE INDEX asset_downloads_downloaded_at_idx ON public.asset_downloads(downloaded_at DESC);
CREATE INDEX asset_downloads_downloaded_by_idx ON public.asset_downloads(downloaded_by);

GRANT SELECT, INSERT ON public.asset_downloads TO authenticated;
GRANT ALL ON public.asset_downloads TO service_role;

ALTER TABLE public.asset_downloads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read asset_downloads"
  ON public.asset_downloads FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "ops insert asset_downloads"
  ON public.asset_downloads FOR INSERT
  TO authenticated
  WITH CHECK (public.is_operator(auth.uid()) AND downloaded_by = auth.uid());

ALTER PUBLICATION supabase_realtime ADD TABLE public.asset_downloads;
