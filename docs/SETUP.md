# Local Setup

## 1. Prerequisites

- Node.js 20+
- A Supabase project with a Postgres connection string
- An Auth0 tenant with one SPA application and one API
- A Render account
- A Cloudflare account with Workers enabled

## 2. Install dependencies

From the repo root:

```bash
npm install
```

## 3. Configure the backend

Copy `apps/api/.env.example` to `apps/api/.env` and fill in:

- `DATABASE_URL`
- `AUTH0_DOMAIN`
- `AUTH0_AUDIENCE`
- `AUTH0_ISSUER_BASE_URL`
- `FRONTEND_ORIGIN` as a comma-separated allowlist of frontend URLs
- `PORT`

Example:

```bash
FRONTEND_ORIGIN="http://localhost:5173,https://family-prediction-market-web.saakethpula.workers.dev"
```

## 4. Configure the frontend

Copy `apps/web/.env.example` to `apps/web/.env` and fill in:

- `VITE_AUTH0_DOMAIN`
- `VITE_AUTH0_CLIENT_ID`
- `VITE_AUTH0_AUDIENCE`
- `VITE_API_BASE_URL`

## 5. Prepare Prisma

Generate the client and create the initial migration:

```bash
npm run prisma:generate
npm run prisma:migrate
```

## 6. Run the apps

Backend:

```bash
npm run dev:api
```

Frontend:

```bash
npm run dev:web
```

## 7. Smoke test

1. Sign in with Auth0.
2. Create a family group.
3. Join from a second account using the join code.
4. Create a market about the second account.
5. Confirm the second account does not see that market in its dashboard.

## Important guardrail

The hidden-market rule is enforced in the backend query layer. Keep that rule in place for every future feature, including notifications, search, exports, analytics, and admin tooling.
