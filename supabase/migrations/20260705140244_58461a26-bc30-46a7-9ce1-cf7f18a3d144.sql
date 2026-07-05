alter table public.scanner_runs
  add column if not exists phase text,
  add column if not exists phase_detail text,
  add column if not exists assets_found integer not null default 0;