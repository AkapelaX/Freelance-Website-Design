BLUVIXA RESTRUCTURED FRONTEND
================================

CONTENTS
- index.html
- style.css
- app.js
- auth-payments.js

WHAT CHANGED
- Replaced the basic account area with a responsive SaaS dashboard.
- Added Overview, My Website, Subscription, Publishing, Ownership & Export,
  Domains, and Settings dashboard views.
- Preserved the builder's existing element IDs and app.js behavior.
- Preserved Supabase sign-in, Stripe Checkout, Customer Portal, cloud save/load,
  annual subscriptions, 7-day trial, and buyout checkout behavior.
- Added live dashboard synchronization with the current builder state.
- Added an export API request at /api/export-website for buyout customers.

INSTALLATION
1. Back up your current frontend files.
2. Replace index.html, style.css, app.js, and auth-payments.js with these files.
3. Keep your existing assets folder and hero-bluvixa-webicon.webp beside index.html.
4. Keep your existing /api endpoints and Vercel environment variables.
5. Redeploy the project.

IMPORTANT BACKEND NOTES
- Publishing controls in app.js still mark the builder state as published; a public
  deployment requires your publishing backend.
- Export now calls GET /api/export-website. Until that API exists, an owned account
  receives an honest error message instead of a fake download.
- The dashboard reads optional /api/account fields such as trialEnd,
  currentPeriodEnd, renewalDate, projectName, and websiteBoughtOut. It safely falls
  back when those fields are not present.
- Do not place Stripe secret keys or the Supabase service-role key in frontend files.

ASSETS
This ZIP intentionally does not replace your existing uploaded images, favicon files,
or assets directory. Keep those files in the project when replacing the frontend.
