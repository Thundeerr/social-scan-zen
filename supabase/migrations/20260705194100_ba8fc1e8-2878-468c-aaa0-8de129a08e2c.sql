-- Reset next_scan_at for active tracked accounts to align with the new
-- 4 scans/day cadence (~6h intervals). Spread them across the next 6 hours
-- with random jitter so they don't stampede the provider.
UPDATE public.tracked_accounts
SET next_scan_at = now() + (random() * interval '6 hours')
WHERE status = 'active';