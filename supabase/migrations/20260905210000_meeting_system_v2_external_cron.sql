-- Run the meeting workers from Supabase so the CRM does not depend on paid
-- Vercel Cron. The invocation secret stays encrypted in Supabase Vault.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM vault.secrets
    WHERE name = 'meeting_system_v2_cron_secret'
  ) THEN
    PERFORM vault.create_secret(
      replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
      'meeting_system_v2_cron_secret',
      'Supabase pg_cron invocation secret for meeting rules and reminders'
    );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.verify_meeting_system_v2_cron_secret(p_secret text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, vault, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM vault.decrypted_secrets
    WHERE name = 'meeting_system_v2_cron_secret'
      AND decrypted_secret = p_secret
  );
$$;

REVOKE ALL ON FUNCTION public.verify_meeting_system_v2_cron_secret(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_meeting_system_v2_cron_secret(text)
  TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'meeting-rules-worker-v2') THEN
    PERFORM cron.unschedule('meeting-rules-worker-v2');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'meeting-reminders-worker-v2') THEN
    PERFORM cron.unschedule('meeting-reminders-worker-v2');
  END IF;
END;
$$;

SELECT cron.schedule(
  'meeting-rules-worker-v2',
  '* * * * *',
  $cron$
    SELECT net.http_post(
      url := 'https://www.crmleda.online/api/meetings/rules/evaluate',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (
          SELECT decrypted_secret
          FROM vault.decrypted_secrets
          WHERE name = 'meeting_system_v2_cron_secret'
          LIMIT 1
        )
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 55000
    );
  $cron$
);

SELECT cron.schedule(
  'meeting-reminders-worker-v2',
  '*/5 * * * *',
  $cron$
    SELECT net.http_post(
      url := 'https://www.crmleda.online/api/meetings/reminders',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (
          SELECT decrypted_secret
          FROM vault.decrypted_secrets
          WHERE name = 'meeting_system_v2_cron_secret'
          LIMIT 1
        )
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 55000
    );
  $cron$
);

SELECT pg_notify('pgrst', 'reload schema');
