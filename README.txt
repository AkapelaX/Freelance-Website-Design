BLUVIXA 6.0 — STABLE WORKSPACE REBUILD

WHY THIS VERSION EXISTS
The previous frontend had two separate application controllers fighting over:
- routing
- authentication state
- mobile navigation
- pricing buttons
- member pages

Bluvixa 6.0 removes that conflict. It uses:
- app.js only for the existing visual builder and preview
- platform.js for routing, authentication, subscriptions, projects, drafts, domains,
  publishing controls, mobile navigation, buyouts, and exports

WORKING PUBLIC ACTIONS
- Sign In
- Start Free Trial
- All pricing Start Free Trial buttons
- Preview Builder
- Mobile navigation

WORKING MEMBER PAGES
- My Websites
- Saved Drafts
- Website Builder
- Billing & Ownership
- Domains & Publishing

WORKING PROJECT ACTIONS
- Create new website
- Save website
- Edit website
- Duplicate website
- Delete website
- Save snapshot
- Load snapshot
- Delete snapshot
- Buy out a selected website
- Export a purchased website through /api/export-website
- Reserve a Bluvixa subdomain
- Prepare a custom-domain connection
- Search domain suggestions
- Mark websites published or return them to draft

SUPABASE AND STRIPE SETTINGS WERE NOT REPLACED
The frontend still uses:
- GET /api/config
- Supabase Auth
- GET /api/account
- POST /api/project
- POST /api/create-checkout-session
- POST /api/create-portal-session
- GET /api/export-website
- POST /api/domain-search when available

IMPORTANT PRODUCTION NOTES
1. Multi-website projects and snapshots are currently demonstrated with browser storage.
   Move them to Supabase tables for cross-device synchronization.
2. Per-website buyout checkout sends websiteId. Your Stripe webhook should store the
   purchase on that specific website record.
3. Generated *.bluvixa.com addresses are not publicly live until wildcard DNS and the
   publishing backend are connected.
4. Domain suggestions work without a provider. Live availability and registration
   require /api/domain-search and a registrar API.
5. Keep all current Vercel environment variables and webhook settings.

INSTALLATION
Replace:
- index.html
- style.css
- app.js

Add:
- platform.js

Remove from deployment:
- auth-payments.js
- dashboard.js

Keep:
- assets folder
- hero-bluvixa-webicon.webp
- all Vercel API routes and environment variables
