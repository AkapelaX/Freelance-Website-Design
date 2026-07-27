BLUVIXA 7.2 — DRAFT SLUG FIX

This version fixes the unique slug error reported by Supabase.

FIXES
- Draft websites now save with slug = NULL in Supabase.
- Multiple Untitled Website drafts can be created and saved.
- Snapshots continue to save with slug = NULL.
- A unique slug is generated only when a project is published.
- Generated published slugs include a project-specific suffix to prevent collisions.
- Duplicated websites become clean drafts with no inherited slug or domain.
- Starter accounts remain locked to the Starter plan in the builder.

DEPLOYMENT
Replace index.html, style.css, app.js, and platform.js. Keep the existing api folder, Vercel environment variables, Supabase tables, grants, and RLS policies.

No additional SQL is required for this fix.
