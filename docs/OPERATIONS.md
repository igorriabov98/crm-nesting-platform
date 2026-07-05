# Operations

## Production Change Cycle

1. Create a feature branch from `origin/main`.
2. Open a pull request.
3. Wait for `.github/workflows/ci.yml` to pass.
4. Merge into `main` with one writer.
5. Run `Deploy Production` from GitHub Actions on `main`.
6. Approve the `production` environment review in GitHub UI.
7. Let the workflow apply Prisma migrations, handle Supabase SQL migrations, deploy Railway, deploy Vercel from the same SHA, then run `scripts/prod-smoke.ts`.

Railway and Vercel autodeploy from `main` should stay disabled after the operator explicitly changes those settings. Production deploys should come from `deploy.yml`, not from feature branches or provider autodeploy.

## Five Layers

Use this table shape in release reports:

| Layer | Expected | Evidence |
| --- | --- | --- |
| `origin/main` | GitHub `main` at the release SHA | `git log origin/main --oneline -3` |
| Railway production | Deployment SHA equals `origin/main` | `railway deployment list --service <service> --limit 1 --json` |
| Vercel production | Production deployment serves the release SHA | `curl -fsS https://crm-nesting-platform.vercel.app/api/version | jq -r '.sha'` |
| Prod DB schema | Prisma migrations applied, pending 0 | `npx prisma migrate status --schema nesting-service/prisma/schema.prisma` |
| Prod DB seed | Steel catalog contains required rows | `steel_types` count and exact names such as `Ст3сп`, `09Г2С` |

`/api/version` is intentionally public and returns only `{ "sha": "..." }`.
It is the canonical proof for Vercel CLI deploys because CLI deployments do not
always expose Git metadata through `vercel inspect`.

Railway currently exposes a live `/health` endpoint, but its `commit` field is a
known non-critical tail and can be `null`. Until that is wired to a service
version value, use the deploy workflow log or `railway deployment list` message
(`GitHub Actions <sha>`) as the Railway SHA proof.

## Backups

Before non-additive database work, confirm the current production backup location and timestamp in the operator report. Additive Prisma migrations can use the current approved backup only when the operator explicitly says it is still valid.

Supabase SQL migrations are separate from Prisma. The deploy workflow expects a ledger table before it can safely apply `supabase/migrations`:

```sql
CREATE TABLE public._repo_supabase_migrations (
  name text PRIMARY KEY,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);
```

Backfill that ledger for historical migrations before enabling automated Supabase SQL application. Without the ledger, `scripts/apply-supabase-migrations.ts` stops instead of replaying old SQL.

## Red Smoke

If `scripts/prod-smoke.ts` fails:

1. Stop the deploy train.
2. Keep Railway and Vercel on the same SHA unless a rollback is explicitly approved.
3. Save the raw response printed before the parser.
4. Classify the failure by layer: CRM route, Railway API, DB schema, DB seed, storage upload, AI analysis, calculation, DXF, or diagnostic package.
5. Fix in a new branch and repeat PR CI before another production deploy.

## Required GitHub Secrets

For `deploy.yml` with `dry_run=false`, configure these secrets on the `production` environment:

- `DATABASE_URL`
- `SUPABASE_DB_URL`
- `RAILWAY_TOKEN`
- `RAILWAY_PROJECT_ID`
- `RAILWAY_ENVIRONMENT_ID`
- `RAILWAY_SERVICE_ID`
- `VERCEL_TOKEN`
- `VERCEL_PROJECT_ID`
- `VERCEL_ORG_ID`
- `PROD_CRM_URL`
- `PROD_NESTING_URL`
- `NESTING_SERVICE_SECRET`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SMOKE_USER_EMAIL`
- `SMOKE_USER_PASSWORD`
- `SMOKE_OLD_PROJECT_ID`
- `SMOKE_ETALON03_STEP_BASE64` or numbered chunks `SMOKE_ETALON03_STEP_BASE64_1`, `_2`, ...; self-hosted runners may use `SMOKE_ETALON03_STEP_PATH`
- `SMOKE_ETALON03_PDF_BASE64` or numbered chunks `SMOKE_ETALON03_PDF_BASE64_1`, `_2`, ...; self-hosted runners may use `SMOKE_ETALON03_PDF_PATH`

The smoke user must exist in Supabase Auth and in `public.users` with a role that can access nesting. Use `technologist` unless a smoke scenario explicitly needs director-only routes.

For one-time smoke user creation or password rotation, run `npm run smoke:user:create` with `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SMOKE_USER_EMAIL`, and `SMOKE_USER_PASSWORD` in the shell. This writes to Supabase Auth and `public.users`; do it only after explicit operator confirmation.
