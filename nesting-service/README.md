# Nesting Service

Sheet metal nesting microservice for laser cutting workflows. The service exposes HTTP APIs for catalog data, project uploads, STEP parsing jobs, nesting calculation jobs, and result files.

## Requirements

- Node.js 20+
- PostgreSQL 15+ from the CRM environment
- A working `DATABASE_URL`

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
curl.exe http://localhost:4000/api/catalog/sheets
curl.exe http://localhost:4000/api/catalog/gaps
curl.exe -X POST http://localhost:4000/api/catalog/sheets -H "Content-Type: application/json" -d "{\"material\":\"Сталь\",\"thickness\":3,\"width\":2500,\"height\":1250}"
```

`/health` returns `ok` when PostgreSQL is available and `down` when it is not. The response no longer contains a Redis service:

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

## Production

Build the service and run PM2 with `ecosystem.config.js`:

```powershell
npm.cmd run build
npx.cmd pm2 start ecosystem.config.js
npx.cmd pm2 status
```

Expected PM2 processes:

- `nesting-api`
- `step-worker`
- `nesting-worker`

The API runs as one `fork` instance because pg-boss relies on PostgreSQL locks and should not be started in PM2 cluster mode for this service.
