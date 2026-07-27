BLUVIXA 6.1 — SUPABASE CLOUD WORKSPACE

This package upgrades Bluvixa 6.0 so website projects and saved snapshots are
stored in the secure Supabase website_projects table instead of existing only
inside one browser.

WHAT CHANGED
- My Websites loads from Supabase after authentication.
- Save Website upserts the active project to Supabase.
- Create, duplicate, rename, publish, domain changes, and delete synchronize.
- Saved snapshots are also stored securely in the same table.
- Existing browser-local projects are migrated automatically when a signed-in
  account has no cloud projects yet.
- A local browser copy remains as an emergency cache.
- Every project uses a real UUID compatible with the Supabase table.
- Row Level Security continues to restrict every row to its authenticated owner.

DATABASE REQUIREMENT
Run the previously provided SQL that creates:
- public.website_projects
- RLS owner policies
- private website-assets bucket and policies

DEPLOYMENT
Replace the current files with:
- index.html
- style.css
- app.js
- platform.js

Keep all current:
- Vercel API routes
- Supabase environment variables
- Stripe environment variables
- Stripe webhook configuration

IMPORTANT
The project JSON now synchronizes to Supabase. Images currently embedded inside
the builder state may still be stored as data URLs. The website-assets bucket is
ready, but direct asset uploading can be added separately to reduce database
size and improve performance for large photos or videos.
