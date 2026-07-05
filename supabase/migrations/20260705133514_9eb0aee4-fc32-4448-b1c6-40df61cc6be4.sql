
-- Helper: role check for owner/cofounder
CREATE OR REPLACE FUNCTION public.is_operator(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role IN ('owner','cofounder')
  );
$$;

-- Enums
CREATE TYPE public.account_status AS ENUM ('active','paused');
CREATE TYPE public.priority_tier AS ENUM ('S','A','B','C');
CREATE TYPE public.asset_media_type AS ENUM ('image','video','carousel','reel','story');
CREATE TYPE public.review_state AS ENUM ('priority','worth_reviewing','later','reviewed','approved','dismissed','archived');
CREATE TYPE public.scanner_run_status AS ENUM ('queued','running','completed','failed');

-- tracked_accounts
CREATE TABLE public.tracked_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL UNIQUE,
  display_name text NOT NULL,
  avatar_url text,
  followers text,
  status public.account_status NOT NULL DEFAULT 'active',
  tier public.priority_tier NOT NULL DEFAULT 'B',
  notes text,
  last_scan_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tracked_accounts TO authenticated;
GRANT ALL ON public.tracked_accounts TO service_role;
ALTER TABLE public.tracked_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read tracked_accounts" ON public.tracked_accounts FOR SELECT TO authenticated USING (true);
CREATE POLICY "ops insert tracked_accounts" ON public.tracked_accounts FOR INSERT TO authenticated WITH CHECK (public.is_operator(auth.uid()));
CREATE POLICY "ops update tracked_accounts" ON public.tracked_accounts FOR UPDATE TO authenticated USING (public.is_operator(auth.uid())) WITH CHECK (public.is_operator(auth.uid()));
CREATE POLICY "ops delete tracked_accounts" ON public.tracked_accounts FOR DELETE TO authenticated USING (public.is_operator(auth.uid()));

-- watchlists
CREATE TABLE public.watchlists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  color text,
  tier public.priority_tier NOT NULL DEFAULT 'B',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.watchlists TO authenticated;
GRANT ALL ON public.watchlists TO service_role;
ALTER TABLE public.watchlists ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read watchlists" ON public.watchlists FOR SELECT TO authenticated USING (true);
CREATE POLICY "ops insert watchlists" ON public.watchlists FOR INSERT TO authenticated WITH CHECK (public.is_operator(auth.uid()));
CREATE POLICY "ops update watchlists" ON public.watchlists FOR UPDATE TO authenticated USING (public.is_operator(auth.uid())) WITH CHECK (public.is_operator(auth.uid()));
CREATE POLICY "ops delete watchlists" ON public.watchlists FOR DELETE TO authenticated USING (public.is_operator(auth.uid()));

-- watchlist_accounts (link)
CREATE TABLE public.watchlist_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  watchlist_id uuid NOT NULL REFERENCES public.watchlists(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.tracked_accounts(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (watchlist_id, account_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.watchlist_accounts TO authenticated;
GRANT ALL ON public.watchlist_accounts TO service_role;
ALTER TABLE public.watchlist_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read watchlist_accounts" ON public.watchlist_accounts FOR SELECT TO authenticated USING (true);
CREATE POLICY "ops insert watchlist_accounts" ON public.watchlist_accounts FOR INSERT TO authenticated WITH CHECK (public.is_operator(auth.uid()));
CREATE POLICY "ops update watchlist_accounts" ON public.watchlist_accounts FOR UPDATE TO authenticated USING (public.is_operator(auth.uid())) WITH CHECK (public.is_operator(auth.uid()));
CREATE POLICY "ops delete watchlist_accounts" ON public.watchlist_accounts FOR DELETE TO authenticated USING (public.is_operator(auth.uid()));

-- assets
CREATE TABLE public.assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.tracked_accounts(id) ON DELETE CASCADE,
  external_id text,
  media_type public.asset_media_type NOT NULL DEFAULT 'image',
  caption text,
  thumbnail_url text,
  media_url text,
  source_url text,
  likes integer NOT NULL DEFAULT 0,
  comments integer NOT NULL DEFAULT 0,
  detected_at timestamptz NOT NULL DEFAULT now(),
  posted_at timestamptz,
  ai_verdict text,
  ai_confidence numeric,
  ai_reasons jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, external_id)
);
CREATE INDEX assets_account_idx ON public.assets(account_id);
CREATE INDEX assets_detected_idx ON public.assets(detected_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.assets TO authenticated;
GRANT ALL ON public.assets TO service_role;
ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read assets" ON public.assets FOR SELECT TO authenticated USING (true);
CREATE POLICY "ops insert assets" ON public.assets FOR INSERT TO authenticated WITH CHECK (public.is_operator(auth.uid()));
CREATE POLICY "ops update assets" ON public.assets FOR UPDATE TO authenticated USING (public.is_operator(auth.uid())) WITH CHECK (public.is_operator(auth.uid()));
CREATE POLICY "ops delete assets" ON public.assets FOR DELETE TO authenticated USING (public.is_operator(auth.uid()));

-- asset_status
CREATE TABLE public.asset_status (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL UNIQUE REFERENCES public.assets(id) ON DELETE CASCADE,
  state public.review_state NOT NULL DEFAULT 'worth_reviewing',
  reviewer_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.asset_status TO authenticated;
GRANT ALL ON public.asset_status TO service_role;
ALTER TABLE public.asset_status ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read asset_status" ON public.asset_status FOR SELECT TO authenticated USING (true);
CREATE POLICY "ops insert asset_status" ON public.asset_status FOR INSERT TO authenticated WITH CHECK (public.is_operator(auth.uid()));
CREATE POLICY "ops update asset_status" ON public.asset_status FOR UPDATE TO authenticated USING (public.is_operator(auth.uid())) WITH CHECK (public.is_operator(auth.uid()));
CREATE POLICY "ops delete asset_status" ON public.asset_status FOR DELETE TO authenticated USING (public.is_operator(auth.uid()));

-- scanner_runs
CREATE TABLE public.scanner_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status public.scanner_run_status NOT NULL DEFAULT 'queued',
  started_at timestamptz,
  completed_at timestamptz,
  accounts_scanned integer NOT NULL DEFAULT 0,
  assets_detected integer NOT NULL DEFAULT 0,
  error text,
  triggered_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scanner_runs TO authenticated;
GRANT ALL ON public.scanner_runs TO service_role;
ALTER TABLE public.scanner_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read scanner_runs" ON public.scanner_runs FOR SELECT TO authenticated USING (true);
CREATE POLICY "ops insert scanner_runs" ON public.scanner_runs FOR INSERT TO authenticated WITH CHECK (public.is_operator(auth.uid()));
CREATE POLICY "ops update scanner_runs" ON public.scanner_runs FOR UPDATE TO authenticated USING (public.is_operator(auth.uid())) WITH CHECK (public.is_operator(auth.uid()));
CREATE POLICY "ops delete scanner_runs" ON public.scanner_runs FOR DELETE TO authenticated USING (public.is_operator(auth.uid()));

-- activity_log
CREATE TABLE public.activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  description text NOT NULL,
  metadata jsonb,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX activity_log_created_idx ON public.activity_log(created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.activity_log TO authenticated;
GRANT ALL ON public.activity_log TO service_role;
ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read activity_log" ON public.activity_log FOR SELECT TO authenticated USING (true);
CREATE POLICY "ops insert activity_log" ON public.activity_log FOR INSERT TO authenticated WITH CHECK (public.is_operator(auth.uid()));
CREATE POLICY "ops update activity_log" ON public.activity_log FOR UPDATE TO authenticated USING (public.is_operator(auth.uid())) WITH CHECK (public.is_operator(auth.uid()));
CREATE POLICY "ops delete activity_log" ON public.activity_log FOR DELETE TO authenticated USING (public.is_operator(auth.uid()));

-- updated_at triggers
CREATE TRIGGER trg_tracked_accounts_updated BEFORE UPDATE ON public.tracked_accounts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_watchlists_updated BEFORE UPDATE ON public.watchlists FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_watchlist_accounts_updated BEFORE UPDATE ON public.watchlist_accounts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_assets_updated BEFORE UPDATE ON public.assets FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_asset_status_updated BEFORE UPDATE ON public.asset_status FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_scanner_runs_updated BEFORE UPDATE ON public.scanner_runs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_activity_log_updated BEFORE UPDATE ON public.activity_log FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed realistic dummy data
INSERT INTO public.tracked_accounts (username, display_name, avatar_url, followers, status, tier) VALUES
  ('nike','Nike','https://i.pravatar.cc/120?u=nike','312M','active','S'),
  ('adidas','adidas','https://i.pravatar.cc/120?u=adidas','28.5M','active','A'),
  ('apple','Apple','https://i.pravatar.cc/120?u=apple','34.2M','active','S'),
  ('spacex','SpaceX','https://i.pravatar.cc/120?u=spacex','9.1M','active','A'),
  ('natgeo','National Geographic','https://i.pravatar.cc/120?u=natgeo','281M','active','B'),
  ('chanelofficial','Chanel','https://i.pravatar.cc/120?u=chanel','58.7M','active','A'),
  ('gucci','Gucci','https://i.pravatar.cc/120?u=gucci','51.3M','paused','B'),
  ('ferrari','Ferrari','https://i.pravatar.cc/120?u=ferrari','45.9M','active','A'),
  ('porsche','Porsche','https://i.pravatar.cc/120?u=porsche','34.1M','active','B'),
  ('patagonia','Patagonia','https://i.pravatar.cc/120?u=patagonia','5.4M','active','C');

INSERT INTO public.watchlists (name, description, color, tier) VALUES
  ('Mission Critical','Top-priority brands under continuous watch','#ef4444','S'),
  ('Luxury Houses','Fashion & luxury monitoring','#a855f7','A'),
  ('Automotive','Automotive manufacturers','#3b82f6','B'),
  ('Outdoor & Lifestyle','Outdoor and lifestyle labels','#10b981','C');

INSERT INTO public.watchlist_accounts (watchlist_id, account_id)
SELECT w.id, a.id
FROM public.watchlists w
JOIN public.tracked_accounts a ON (
  (w.name = 'Mission Critical' AND a.username IN ('nike','apple','spacex')) OR
  (w.name = 'Luxury Houses' AND a.username IN ('chanelofficial','gucci')) OR
  (w.name = 'Automotive' AND a.username IN ('ferrari','porsche')) OR
  (w.name = 'Outdoor & Lifestyle' AND a.username IN ('patagonia','natgeo'))
);

INSERT INTO public.assets (account_id, external_id, media_type, caption, thumbnail_url, source_url, likes, comments, detected_at, ai_verdict, ai_confidence, ai_reasons)
SELECT
  a.id,
  'seed-' || a.username || '-' || g,
  (ARRAY['image','video','reel','carousel']::public.asset_media_type[])[1 + (g % 4)],
  'Detected asset from ' || a.display_name || ' — sequence ' || g,
  'https://picsum.photos/seed/' || a.username || '-' || g || '/800/800',
  'https://instagram.com/' || a.username,
  (10000 + (g * 137) % 90000)::int,
  (100 + (g * 17) % 900)::int,
  now() - (g || ' minutes')::interval,
  (ARRAY['KEEP','REVIEW','DISMISS'])[1 + (g % 3)],
  0.6 + ((g % 40)::numeric / 100),
  jsonb_build_array('High engagement velocity','Consistent with brand pattern','Matches operator history')
FROM public.tracked_accounts a
CROSS JOIN generate_series(1, 4) g;

INSERT INTO public.asset_status (asset_id, state)
SELECT id,
  (CASE (row_number() OVER () % 5)
    WHEN 0 THEN 'priority'
    WHEN 1 THEN 'worth_reviewing'
    WHEN 2 THEN 'later'
    WHEN 3 THEN 'approved'
    ELSE 'dismissed'
  END)::public.review_state
FROM public.assets;

INSERT INTO public.scanner_runs (status, started_at, completed_at, accounts_scanned, assets_detected) VALUES
  ('completed', now() - interval '15 minutes', now() - interval '12 minutes', 10, 40),
  ('completed', now() - interval '1 hour', now() - interval '57 minutes', 10, 38),
  ('completed', now() - interval '2 hours', now() - interval '1 hour 56 minutes', 10, 33),
  ('running', now() - interval '30 seconds', NULL, 4, 6);

INSERT INTO public.activity_log (event_type, description, metadata) VALUES
  ('scan.completed','Scan cycle completed — 40 assets detected across 10 accounts', '{"assets":40,"accounts":10}'::jsonb),
  ('asset.approved','Operator approved 12 assets in review session', '{"count":12}'::jsonb),
  ('account.added','Tracked account added to Mission Critical', '{"account":"nike"}'::jsonb),
  ('scan.started','Autonomous scan cycle initiated', '{}'::jsonb);
