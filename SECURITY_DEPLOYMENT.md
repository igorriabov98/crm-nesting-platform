# Security Deployment Checklist

Use this checklist for the Vercel production rollout of the security hardening branch.

## Vercel environment

Set these variables for both Preview and Production without printing secret values in logs:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_APP_URL`
- `NESTING_SERVICE_URL`
- `TELEGRAM_BOT_TOKEN` if the token is not stored in `app_settings`
- `TELEGRAM_WEBHOOK_SECRET`
- `MEETING_REMINDER_CRON_SECRET` or `CRON_SECRET`

After changing Vercel environment variables, redeploy the app. Existing deployments do not pick up changed env vars.

## Telegram webhook

Configure Telegram with the same secret value stored in `TELEGRAM_WEBHOOK_SECRET`:

```bash
curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d "{\"url\":\"https://<production-domain>/api/telegram/webhook\",\"secret_token\":\"<TELEGRAM_WEBHOOK_SECRET>\"}"
```

The route rejects requests without the `x-telegram-bot-api-secret-token` header.

## Vercel cron / meeting reminders

The meeting reminder endpoint accepts:

- `Authorization: Bearer <MEETING_REMINDER_CRON_SECRET>`
- or `x-cron-secret: <MEETING_REMINDER_CRON_SECRET>`

Do not schedule this endpoint until the secret is present in Vercel Production.

## Supabase database

Vercel deploys do not apply Supabase migrations. Apply the new migration to the production Supabase project after validating it on a preview or staging project:

```bash
supabase link --project-ref <production-project-ref>
supabase db push
```

If Supabase CLI is not linked on this machine, run the contents of the new migration in the Supabase Dashboard SQL editor during a maintenance window.

## Supabase Edge Function

Set Edge Function secrets and redeploy:

```bash
supabase secrets set DAILY_CHECK_SECRET=<secret> CRON_SECRET=<secret>
supabase functions deploy daily-check
```

The function accepts either `Authorization: Bearer <secret>` or `x-cron-secret: <secret>`.

## Post-deploy checks

- `npm.cmd audit --omit=dev`
- `npm.cmd run build`
- Vercel production URL returns `Content-Security-Policy`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`.
- `/api/telegram/webhook` returns 401 without the Telegram secret header.
- `/api/meetings/reminders` returns 401 without the cron secret and 503 if the secret is missing in env.
- Nesting `status`, `result`, and `dxf` routes reject users without the nesting role.
- Direct Supabase REST mutations to materials, inventory, request sections, steel types, suppliers, and supply schedules are denied for roles outside the new RLS policies.
