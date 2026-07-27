BLUVIXA 12.2 — ACCOUNT INVOCATION FIX

The Vercel log showed:
FUNCTION_INVOCATION_FAILED on GET /api/account

That means the previous function crashed while its module was loading, before
the normal error handler could respond.

This version replaces api/account.js with a standalone endpoint that:
- has no imports
- does not initialize Stripe or Supabase SDK clients at module load
- verifies the Supabase access token through the Auth REST endpoint
- reads the profiles row through the Supabase REST endpoint
- returns the exact plan/status fields expected by platform.js
- returns useful JSON errors instead of FUNCTION_INVOCATION_FAILED

DEPLOY
1. Replace the entire old api folder with the api folder in this package.
2. Replace the matching root files.
3. Commit and push.
4. Wait until Vercel says Ready.
5. Sign out, close the Bluvixa browser tab, reopen it, and sign back in.

Do not upload .env.local. Confirm these exist in Vercel Production:
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
and the Stripe price IDs used by checkout.
