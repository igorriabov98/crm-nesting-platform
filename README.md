# CRM + Nesting Platform

This repository contains two separate services that are published together as one GitHub repository.

## Projects

- `crm/` - Next.js CRM application.
- `nesting-service/` - Node.js nesting microservice used by the CRM.

## Local Development

Install and run each service from its own folder:

```bash
cd crm
npm install
npm run dev
```

```bash
cd nesting-service
npm install
npm run dev
```

The CRM talks to the nesting service through `NESTING_SERVICE_URL`.

## Environment Files

Real `.env` and `.env.local` files are intentionally ignored and must not be committed.
Use each service's `.env.example` as a template:

- `crm/.env.example`
- `nesting-service/.env.example`

## Deployment

For Vercel CRM deployment, import this repository and set the Vercel Root Directory to:

```text
crm
```

Deploy `nesting-service/` separately on a Node.js host that supports long-running processes and workers, then set the CRM environment variable:

```text
NESTING_SERVICE_URL=https://your-nesting-service.example.com
```

The nesting service also requires its own database/runtime environment variables.
