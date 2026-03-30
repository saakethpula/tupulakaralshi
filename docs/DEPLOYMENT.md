# Deployment Guide

## Supabase

1. Create a Supabase project.
2. Copy the Postgres connection string.
3. Put that value into Render as `DATABASE_URL`.
4. Run Prisma migrations before going live.

## Render backend

This repo includes `render.yaml` for `apps/api`.

Set:

- `DATABASE_URL`
- `AUTH0_DOMAIN`
- `AUTH0_AUDIENCE`
- `AUTH0_ISSUER_BASE_URL`
- `FRONTEND_ORIGIN`
- `PORT`

`FRONTEND_ORIGIN` can be a comma-separated allowlist if you want the deployed API to accept both local development and production frontend origins.

Example:

```bash
FRONTEND_ORIGIN="http://localhost:5173,https://family-prediction-market-web.saakethpula.workers.dev"
```

Build/start flow:

```bash
npm install
npm run prisma:generate
npm run build
npm run start
```

Optionally run:

```bash
npm run prisma:deploy
```

before starting the service.

## Cloudflare Workers frontend

Deploy the frontend workspace only. If you run Wrangler from the repo root, it will fail because this repository is an npm workspace monorepo.

Set:

- `VITE_AUTH0_DOMAIN`
- `VITE_AUTH0_CLIENT_ID`
- `VITE_AUTH0_AUDIENCE`
- `VITE_API_BASE_URL`

Build/deploy:

```bash
npm install
npm run build:web
npm run deploy:web
```

If you prefer running commands manually, switch to `apps/web` first:

```bash
cd apps/web
npm run build
npx wrangler deploy
```

For Cloudflare Pages builds, set:

- Root directory: `apps/web`
- Build command: `npm run build`
- Build output directory: `dist`

## Final production checklist

1. Update Auth0 callback, logout, and web origin URLs to the deployed frontend URL.
2. Set Render `FRONTEND_ORIGIN` to the deployed frontend URL, or to a comma-separated allowlist if you also want local development to hit the deployed API.
3. Confirm CORS and login work.
4. Test with two users in the same family group.
5. Verify the target user does not receive hidden markets from `GET /api/markets`.
