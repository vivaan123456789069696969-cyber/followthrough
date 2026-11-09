-- Phase 6: reminder defaults, and Supabase calling the app's scheduled jobs every 15 minutes.

-- The defaults the user chose: off until turned on; then 08:00, quiet 21:00 to 07:00.
alter table public.reminder_prefs
  alter column digest_time set default '08:00',
  alter column quiet_start set default '21:00',
  alter column quiet_end set default '07:00';

alter table public.reminder_log
  add constraint reminder_log_kind_check check (kind in ('due_today', 'due_tomorrow', 'overdue', 'waiting_weekly')),
  add constraint reminder_log_resend_id_length check (char_length(resend_id) <= 200);

create index reminder_prefs_enabled_idx on public.reminder_prefs (enabled) where enabled;

-- ---------------------------------------------------------------------------
-- Every 15 minutes, pg_cron asks the app to send due reminders and retry Google syncs.
-- The app's address and the job secret are read from Supabase Vault when the job runs:
--   select vault.create_secret('https://YOUR_APP', 'app_url');
--   select vault.create_secret('THE_CRON_SECRET', 'cron_secret');
-- Until both exist the job does nothing. Projects without pg_net or Vault skip this.
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net')
    and exists (select 1 from pg_namespace where nspname = 'vault')
    and exists (select 1 from pg_extension where extname = 'pg_cron') then
    create extension if not exists pg_net;
    -- pg_net briefly holds request headers (with the job secret) before sending them. Only
    -- the database's own roles may use it; signed-in and signed-out users may not.
    execute 'revoke all on schema net from anon, authenticated';
    execute 'revoke execute on all functions in schema net from anon, authenticated';
    perform cron.schedule('call-app-jobs', '*/15 * * * *', $job$
      select net.http_get(
        url := app.decrypted_secret || path,
        headers := jsonb_build_object('authorization', 'Bearer ' || secret.decrypted_secret),
        timeout_milliseconds := 60000
      )
      from vault.decrypted_secrets app, vault.decrypted_secrets secret,
        (values ('/api/cron/reminders'), ('/api/cron/google-sync')) as jobs (path)
      -- The secret only ever travels over https.
      where app.name = 'app_url' and secret.name = 'cron_secret' and app.decrypted_secret like 'https://%'
    $job$);
  else
    raise warning 'pg_net, Vault or pg_cron unavailable: app jobs are not scheduled from the database';
  end if;
end;
$$;
