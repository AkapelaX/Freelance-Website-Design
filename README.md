# Bluvixa Consolidated Production

This package consolidates the browser code into one `app.js` and routes the application API through one Vercel entry function, `api/api.js`. Stripe keeps its own webhook entry at `api/stripe-webhook.js`.

## Deploy
1. Extract this ZIP into the root of the Bluvixa Git repository, replacing matching files.
2. Do not commit `.env.local`.
3. Run `npm install` and `npm run check`.
4. Commit and push.

## Required Vercel environment variables
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, Stripe price IDs, and any Vercel domain-management variables used by the domain system.

## Stripe webhook
Set Stripe to `https://bluvixa.com/api/stripe-webhook`.
