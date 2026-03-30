# Auth0 Setup

## Create the API

Create an Auth0 API with:

- Name: `Family Prediction Market API`
- Identifier: `https://family-market-api`
- Signing algorithm: `RS256`

## Create the SPA

Create one Single Page Application for the frontend.

Allowed Callback URLs:

- `http://localhost:5173`
- your Cloudflare Workers URL

Allowed Logout URLs:

- `http://localhost:5173`
- your Cloudflare Workers URL

Allowed Web Origins:

- `http://localhost:5173`
- your Cloudflare Workers URL

## Requested scopes

Request:

- `openid`
- `profile`
- `email`

The backend provisions users from Auth0 claims, so the access token flow needs usable `sub` and `email`, with `name` and `picture` recommended.

## Add custom claims to the access token

If your API access token does not include `email`, add a Post Login Action that writes namespaced claims for this API. The backend accepts both plain claims and namespaced claims such as `https://family-market-api/email`.

Example Action:

```js
exports.onExecutePostLogin = async (event, api) => {
  const namespace = "https://family-market-api/";

  api.accessToken.setCustomClaim(`${namespace}email`, event.user.email);
  api.accessToken.setCustomClaim(`${namespace}name`, event.user.name);
  api.accessToken.setCustomClaim(`${namespace}picture`, event.user.picture);
};
```

## Environment values

Frontend:

- `VITE_AUTH0_DOMAIN`
- `VITE_AUTH0_CLIENT_ID`
- `VITE_AUTH0_AUDIENCE`

Backend:

- `AUTH0_DOMAIN`
- `AUTH0_AUDIENCE`
- `AUTH0_ISSUER_BASE_URL`

## Production note

If you use a custom Auth0 domain, keep that exact domain consistent across Auth0, the frontend, and the backend.
