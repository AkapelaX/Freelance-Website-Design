BLUVIXA 3.0 — COMPLETE FRONTEND PACKAGE
=========================================

FILES
- index.html
- style.css
- app.js
- auth-payments.js

WHAT THIS VERSION IMPROVES
- Adds an unmistakable green “Bluvixa Member” confirmation at the top of the signed-in dashboard.
- Shows the signed-in email, plan, subscription status, and ownership status clearly.
- Keeps the full SaaS dashboard: Overview, My Website, Subscription, Publishing,
  Ownership & Export, Domains, and Settings.
- Keeps all existing builder controls, website preview rendering, themes, media,
  plan limits, maps, domains, local drafts, Supabase authentication, Stripe Checkout,
  Stripe Customer Portal, cloud save/load, and website-buyout logic.
- Fixes the confusing mobile “browser blocked local saving” experience.
- Uses IndexedDB as expanded device storage when large photos/videos exceed localStorage.
- Gives clear save states: Saving, Saved on this device, Use Cloud Save, or Sign in for Cloud Save.

INSTALLATION
1. Back up your current frontend.
2. Replace index.html, style.css, app.js, and auth-payments.js with these files.
3. Keep your current assets folder and hero-bluvixa-webicon.webp.
4. Keep your existing Vercel API routes and environment variables.
5. Redeploy.

BACKEND TRUTH
- Membership means the user is authenticated through Supabase.
- Subscription status and plan come from /api/account and Stripe webhook data.
- Cloud Save uses /api/project.
- Billing uses /api/create-portal-session.
- Buyout uses /api/create-checkout-session with purchaseType “buyout”.
- Raw-code export calls GET /api/export-website and needs that server endpoint.
- The builder’s Publish button records publishing state; real public deployment still
  requires the publishing backend.

SECURITY
Never place Stripe secret keys or the Supabase service-role key in these frontend files.
