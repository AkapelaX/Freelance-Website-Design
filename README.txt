BLUVIXA 4.0 COMPLETE REBUILD

This is a full frontend rebuild, not a CSS patch.

NEW APPLICATION FLOW
1. Public landing page
2. Sign in or create account
3. Member Dashboard
4. Saved Drafts page
5. Existing visual Builder with its preview preserved
6. Billing & Ownership page with visible website-buyout options
7. Domain center

PRESERVED
- Supabase configuration is still fetched from /api/config.
- Supabase authentication remains unchanged.
- Stripe Checkout still uses /api/create-checkout-session.
- Stripe Customer Portal still uses /api/create-portal-session.
- Cloud projects still use /api/project.
- Account status still uses /api/account.
- Existing builder state, visual preview, plan limits, media, maps, themes, domains,
  local saving, cloud save/load, and publishing state remain in app.js.

SAVED DRAFTS
- “Save to Drafts” creates named snapshots in the Saved Drafts page.
- Users can search, load, and delete snapshots.
- Up to 30 browser snapshots are retained.
- Media-heavy projects should also be saved to the cloud because browser storage
  limits vary by device.

WEBSITE BUYOUT
- The Billing & Ownership page visibly shows the buyout option.
- Starter: $499
- Professional: $599
- Advanced: $699
- The buyout button uses the existing Stripe checkout route.
- Website ownership remains permanent in the account data when the backend webhook
  records websiteBoughtOut.
- ZIP download calls /api/export-website after ownership is confirmed.

INSTALL
Replace index.html, style.css, app.js, auth-payments.js, and add dashboard.js.
Keep your current assets folder, favicon files, Vercel API routes, Supabase variables,
and Stripe variables.
