-- Operator deployment step after app and migration checks. Does not enable generation.
begin;
select cron.schedule('kiikii-business-report-every-minute','* * * * *',$cron$
 select net.http_post(
  url := 'https://instascanner.app/api/public/business-report/tick',
  headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',
    (select decrypted_secret from vault.decrypted_secrets where name='CRON_SECRET' limit 1)),
  body := '{}'::jsonb, timeout_milliseconds := 60000);
$cron$);
update public.business_report_settings set enabled=true,updated_at=now()
where user_id='e4ee414f-fbb6-4f82-b5fc-22d74ed6b3cc';
commit;
