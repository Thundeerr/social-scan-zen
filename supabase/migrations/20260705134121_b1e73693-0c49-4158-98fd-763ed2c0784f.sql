ALTER PUBLICATION supabase_realtime ADD TABLE public.assets;
ALTER PUBLICATION supabase_realtime ADD TABLE public.asset_status;
ALTER TABLE public.assets REPLICA IDENTITY FULL;
ALTER TABLE public.asset_status REPLICA IDENTITY FULL;