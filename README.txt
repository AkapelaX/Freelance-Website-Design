BLUVIXA 4.1 — MEMBER HOME & TRIAL CLARITY

THIS UPDATE FIXES
- Signed-in customers are automatically sent to the Member Dashboard instead of
  remaining on the public marketing page.
- The public “Start Free Trial” button is replaced by “Open My Dashboard” for a
  recognized Supabase session.
- The dashboard clearly displays the real plan and subscription status returned by
  /api/account, including Starter + Trial Active.
- A full mobile hamburger menu now provides Dashboard, Saved Drafts, Builder,
  Billing & Ownership, Domains, and Sign Out.
- A loading screen prevents the public page from flashing while Supabase checks the
  session.
- The member dashboard welcomes the user by name and presents the trial or active
  subscription in a large status card.

PRESERVED WITHOUT CHANGING SETTINGS
- Supabase URL and anon key are still loaded from /api/config.
- Supabase authentication remains the existing implementation.
- Stripe Checkout remains /api/create-checkout-session.
- Stripe Customer Portal remains /api/create-portal-session.
- Account information remains /api/account.
- Cloud projects remain /api/project.
- Website buyout still uses purchaseType: "buyout".
- No Supabase or Stripe secret/environment settings are embedded or replaced.

GENERATED WEBSITE URLS
The builder already generates a proposed address such as:
  https://my-business.bluvixa.com

The dashboard now shows that generated address. Making it publicly accessible still
requires the publishing backend, wildcard DNS for *.bluvixa.com, and deployment/routing
that serves the correct saved website by slug. The frontend does not falsely claim
that an undeployed address is live.

INSTALLATION
Replace:
- index.html
- style.css
- app.js
- auth-payments.js
- dashboard.js

Keep:
- your assets folder
- hero-bluvixa-webicon.webp
- all Vercel API routes
- all Supabase environment variables
- all Stripe environment variables and webhook settings
