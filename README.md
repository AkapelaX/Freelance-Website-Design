# Bluvixa Hobby Production

Consolidated production build with two Vercel serverless entry points:

- `api/api.js` — authentication config, accounts, projects, publishing, public sites, billing sessions, exports, and domains.
- `api/stripe-webhook.js` — raw-body Stripe webhook.

Backend implementation modules are stored in `server/`, outside Vercel's API function directory. The database contract is defined by `supabase/schema.sql`.
