-- pg_cron is already used by this application's existing migrations.
-- The named job is replaced on re-application; it executes as the migration owner.
select cron.schedule('smartlink-retention-daily', '17 3 * * *', 'select public.sl_purge()');
