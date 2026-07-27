BLUVIXA 10.0 — ONE-CLICK PUBLISHING

This release turns published Bluvixa projects into real public websites.

WHAT WORKS
- Publish Now saves and publishes the selected website.
- Every published site receives a working URL:
  https://bluvixa.com/site/your-slug
- View Live opens the public website.
- Unpublish removes public access immediately.
- Public pages load project text, colors, logo, header image, photos, videos,
  gallery, contact details, call buttons, and map.
- Private Supabase rows remain protected by RLS.
- The public website API uses the service-role key only on the server.
- Custom domains can be added to the Vercel project from Bluvixa when the
  required Vercel environment variables are configured.

DEPLOYMENT

Replace:
- index.html
- style.css
- app.js
- platform.js

Add:
- public-site.html
- public-site.css
- public-site.js
- vercel.json
- api/public-site.js
- api/publish-site.js
- api/connect-domain.js

Run:
- SUPABASE-10.0-PUBLISHING.sql

REQUIRED VERCEL ENVIRONMENT VARIABLES
Existing:
- SUPABASE_URL
- SUPABASE_ANON_KEY

Add if not already present:
- SUPABASE_SERVICE_ROLE_KEY

For automatic custom-domain connections:
- VERCEL_TOKEN
- VERCEL_PROJECT_ID
- VERCEL_TEAM_ID (only when the project belongs to a Vercel team)

SECURITY
SUPABASE_SERVICE_ROLE_KEY and VERCEL_TOKEN are server secrets.
Never place either value inside index.html, app.js, platform.js, or any
NEXT_PUBLIC_/VITE_ browser variable.

VERCEL.JSON
If your deployed project already has a vercel.json, merge this rewrite into its
existing "rewrites" array instead of deleting unrelated settings:

{ "source": "/site/:slug", "destination": "/public-site.html?slug=:slug" }

TEST
1. Deploy all files.
2. Sign in.
3. Open Domains & Publishing.
4. Press Publish Now.
5. The public site opens in a new tab.
6. Change content in the builder and wait for autosave.
7. Refresh the live site to confirm the change.
8. Press Unpublish and confirm the public URL becomes unavailable.
