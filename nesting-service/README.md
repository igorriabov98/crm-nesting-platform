# Nesting Service

Sheet metal nesting microservice for laser cutting workflows. The service exposes HTTP APIs for catalog data, project uploads, STEP parsing jobs, nesting calculation jobs, and result files.

## Requirements

- Node.js 22
- PostgreSQL 15+ from the CRM environment
- A working `DATABASE_URL`
- A private Supabase Storage bucket named `nesting-files`

Queues run through `pg-boss`, which uses PostgreSQL and creates its own `pgboss` schema on first startup. Redis and Docker are not required.

## Setup

1. Copy `.env.example` values into `.env`.
2. Set `DATABASE_URL` to the CRM PostgreSQL database with `?schema=nesting`.
3. If Prisma cannot connect to Supabase directly, apply the manual SQL setup in Supabase SQL Editor:

```text
supabase/nesting_manual_setup.sql
```

This file creates the `nesting` schema, all service tables, indexes, constraints, and seed rows. It does not create pg-boss tables; pg-boss creates its own `pgboss` schema automatically when the API or a worker starts.

4. Install and initialize locally:

```powershell
npm.cmd install
npm.cmd run db:generate
npx.cmd prisma db push
npm.cmd run db:seed
npm.cmd run build
npm.cmd run dev
```

Skip `npx.cmd prisma db push` and `npm.cmd run db:seed` when the SQL was applied manually in Supabase.

PowerShell may block `npm.ps1`, so use `npm.cmd` and `npx.cmd` on Windows. For UNC paths, use `pushd`:

```powershell
cmd /d /c 'pushd "\\Mac\Home\Desktop\Tehnolog\nesting-service" && npm.cmd install && popd'
```

## API Checks

```powershell
curl.exe http://localhost:4000/health
curl.exe http://localhost:4000/api/catalog/sheets -H "Authorization: Bearer <NESTING_SERVICE_SECRET>"
curl.exe http://localhost:4000/api/catalog/gaps -H "Authorization: Bearer <NESTING_SERVICE_SECRET>"
curl.exe -X POST http://localhost:4000/api/catalog/sheets -H "Content-Type: application/json" -d "{\"material\":\"Сталь\",\"thickness\":3,\"width\":2500,\"height\":1250}"
```

`/health` is public and intentionally returns only the overall status. Detailed database and queue state is available at protected `/api/health`:

```json
{
  "status": "ok"
}
```

```json
{
  "status": "ok",
  "services": {
    "database": { "status": "ok", "latencyMs": 5 },
    "queues": {
      "stepParsing": { "queued": 0 },
      "nesting": { "queued": 0 }
    }
  }
}
```

## Workers

Development workers:

```powershell
npm.cmd run worker:step
npm.cmd run worker:nesting
```

The STEP worker handles one job at a time. The nesting worker registers two pg-boss workers in the same process for two concurrent nesting jobs.

## Production / Railway

Railway must use this directory as the service root. `Dockerfile` builds on Node 22 and `pm2-runtime` starts one API process, one STEP worker, and one nesting worker. Use one Railway replica.

Apply `../supabase/migrations/20260618000000_nesting_storage.sql` before deployment. Set `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NESTING_SERVICE_SECRET`, `CORS_ORIGIN`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `OPENROUTER_BASE_URL`, and `AI_SETTINGS_ENCRYPTION_KEY` in Railway.

Expected PM2 processes:

- `nesting-api`
- `step-worker`
- `nesting-worker`

Production accepts JSON `supabase://bucket/path` references only. Legacy multipart remains available only in local development. Railway has no persistent volume; workers materialize Storage objects under the OS temporary directory and remove them after processing. DXF and ZIP outputs are written back to `nesting-files`.
