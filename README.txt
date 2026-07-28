BLUVIXA 12.0 — STABILITY FIX

This package fixes the current account and builder crashes without including any secret environment file.

FIXED
- /api/account 500: profile lookup uses select(*) so optional/missing columns no longer break the route.
- Account recovery: if the profile is stale, the route searches Stripe by the signed-in email, restores the customer/subscription link, and updates Supabase.
- app.js photos crash: enforcePlan now validates the plan and initializes photos/gallery arrays before slicing.
- Stripe webhook, checkout, and billing portal use one ESM backend library and consistent metadata.
- Added all frontend-requested API routes.
- Browser cache version bumped.

DEPLOY
1. Do not upload .env.local. Keep the same values in Vercel Environment Variables.
2. Replace the deployed project files with this package.
3. Run npm install, commit, and deploy through Vercel.
4. In Stripe, confirm the webhook endpoint is https://bluvixa.com/api/stripe-webhook.
5. Sign out, close the Bluvixa tab, reopen it, and sign in.

SECURITY
The ZIP contains .env.example only. Your uploaded secret keys were deliberately excluded.
