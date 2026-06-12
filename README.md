# CRM + Nesting Platform

This repository publishes the CRM and the nesting service together.

## Structure

- Repository root - Next.js CRM application, ready for Vercel.
- `nesting-service/` - separate Node.js nesting microservice used by the CRM.

## CRM Deployment On Vercel

Import this repository into Vercel as a Next.js project.

Use the repository root as the Vercel Root Directory. The default build command is:

```bash
npm run build
```

Required CRM environment variables:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_APP_URL=
NESTING_SERVICE_URL=
```

## Nesting Service

Deploy `nesting-service/` separately on a Node.js host that supports a long-running API process and workers.
After deploying it, set the CRM `NESTING_SERVICE_URL` to the public HTTPS URL of that service.

## Local Development

CRM:

```bash
npm install
npm run dev
```

Nesting service:

```bash
cd nesting-service
npm install
npm run dev
```

Real `.env` and `.env.local` files are intentionally ignored.
