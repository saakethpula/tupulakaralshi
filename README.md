# Bet With Friends

A private, Kalshi-inspired prediction market for family and friends use. People can create markets about each other, while the person a market is about is prevented from seeing or participating in it.

## Stack

- Frontend: React + Vite + Cloudflare Workers
- Backend: Node.js + Express on Render
- Database: Supabase Postgres + Prisma ORM
- Authentication: Auth0

## Project Structure

- `apps/web`: frontend deployed to Cloudflare Workers
- `apps/api`: backend API and Prisma schema deployed to Render
- `docs/SETUP.md`: local setup guide
- `docs/AUTH0_SETUP.md`: Auth0 configuration guide
- `docs/DEPLOYMENT.md`: deployment walkthrough

## Core Rules

- Markets belong to a group.
- A market targets one member.
- The targeted member cannot view or trade in that market.
- Users are provisioned automatically on first login.
- The first user in a group becomes an admin and can share a join code.
