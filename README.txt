BLUVIXA 7.0 — CLOUD-FIRST WORKSPACE

This package makes Supabase website_projects the primary signed-in workspace.

FIXES
- Empty website_projects is treated as a valid empty workspace, not an error.
- The large “Cloud projects could not be loaded” notification is removed.
- Project saves attempt a Supabase upsert even if the first cloud read was unavailable.
- Cloud synchronization no longer deletes remote rows by comparing them with a local cache.
- Project and snapshot deletes remove only the selected owner-owned record.
- Existing browser-only projects migrate automatically when the cloud table is empty.
- A browser cache remains only as an emergency backup.
- The builder plan is locked to the signed-in account plan from /api/account.
- Starter members see Starter only; Professional and Advanced are not selectable in the builder.

DEPLOYMENT
Replace index.html, style.css, app.js, and platform.js. Keep the existing api folder, Vercel environment variables, Stripe configuration, and Supabase SQL/RLS policies.

TEST
1. Deploy to Vercel.
2. Sign in on bluvixa.com.
3. Create a test website and select Save Website.
4. Refresh public.website_projects in Supabase.
5. Confirm a row appears with owner_id matching the signed-in user.
