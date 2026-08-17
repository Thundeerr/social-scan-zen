SELECT cron.schedule(
  'monitor-check-every-10min',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--ce0fb3b8-4989-4edb-bd54-0e1864d5ab04.lovable.app/api/public/cron/check',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'CRON_SECRET' LIMIT 1)
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);