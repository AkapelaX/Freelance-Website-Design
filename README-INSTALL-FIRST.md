# BLUVIXA — HOBBY PRODUCTION INSTALL

This ZIP is organized so its contents go directly into the Git repository root.
Do not place the extracted folder itself inside the repository.

## Expected root structure

- api/
  - api.js
  - stripe-webhook.js
- server/
  - backend implementation modules
- supabase/schema.sql
- index.html
- app.js
- style.css
- public-site.html
- package.json
- vercel.json

Only two files live under `api/`, keeping the deployment Hobby-plan friendly.
All normal endpoints are rewritten to `api/api.js`; Stripe keeps a separate webhook because it requires the raw request body.

## Installation

1. Keep the repository's hidden `.git` folder.
2. Delete the old project files.
3. Copy everything inside this package directly into the repository root.
4. Do not copy `.env.local` to GitHub.
5. In Supabase SQL Editor, run `supabase/schema.sql`.
6. Confirm Vercel environment variables.
7. Commit and push.

## First tests after deployment

- `/api/health`
- `/api/config`
- sign in
- save/load project
- publish and open `/site/your-slug`

## Required Vercel environment variables

SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
STRIPE_PRICE_STARTER_ANNUAL
STRIPE_PRICE_PROFESSIONAL_ANNUAL
STRIPE_PRICE_ADVANCED_ANNUAL
STRIPE_PRICE_STARTER_BUYOUT
STRIPE_PRICE_PROFESSIONAL_BUYOUT
STRIPE_PRICE_ADVANCED_BUYOUT
VERCEL_TOKEN
VERCEL_PROJECT_ID
VERCEL_TEAM_ID (only for a team-owned project)
