BLUVIXA 7.1 — VERIFIED CLOUD SAVE FIX

This version fixes the actual save flow instead of hiding the warning.

CHANGES
- Save Website now waits for Supabase and confirms only after the row is written.
- The website_projects table may be empty without being treated as an error.
- Cloud reads use the live table schema with SELECT *.
- Database-managed created_at and updated_at values are no longer forced by the browser.
- New projects, edits, snapshots, domains, publishing changes, duplicates, and deletes synchronize to Supabase.
- Starter accounts are locked to Starter in the builder.
- Professional and Advanced are not selectable from a Starter workspace.
- No generic cloud warning appears at sign-in.
- A real Supabase error is shown only when an attempted save fails.
- Browser storage remains an emergency backup only.

DEPLOYMENT
Replace index.html, style.css, app.js, and platform.js. Keep the existing api folder and Vercel environment variables. Redeploy after replacement.

TEST
Sign in, create a website, enter a business name, press Save Website, then refresh public.website_projects in Supabase. The app will show “Website saved to your cloud account” only after Supabase accepts the row.
