# Bluvixa Backend Connection Patch

This build adds a direct `/api/config` serverless function so the browser can initialize Supabase without depending on a rewrite through the consolidated API router.

## Required Vercel variables

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY` (or `SUPABASE_PUBLISHABLE_KEY`)
- `SUPABASE_SERVICE_ROLE_KEY` (or update backend code to use `SUPABASE_SECRET_KEY`)

Stripe and Vercel variables remain required for billing and domain features.

## Verification

After deployment, open:

- `/api/config` — should return only the Supabase URL and public/anon key.
- `/api/health` — returns booleans only and never reveals secret values.

Then reload Bluvixa and test sign-in.
