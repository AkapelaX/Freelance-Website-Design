BLUVIXA 11.2.3 — AUTHENTICATION CONNECTION FIX

ROOT CAUSE
The deployed package did not contain /api/config.js. platform.js depends on
that route to receive the public Supabase URL and anonymous key. Without it,
the page could open, but Sign In displayed "Authentication is not connected."

FIXED
- Restored api/config.js.
- The route reads SUPABASE_URL and SUPABASE_ANON_KEY from Vercel.
- Also accepts NEXT_PUBLIC_ and VITE_ variants as fallbacks.
- Added no-cache headers.
- Authentication startup now displays the precise configuration error rather
  than silently leaving Sign In disconnected.
- Keeps the logged-in loading fix and Publishing Center reliability updates.

DEPLOY
Replace:
- index.html
- platform.js
- api/config.js

You may deploy the complete ZIP instead.

VERCEL ENVIRONMENT VARIABLES
These must exist for Production:
- SUPABASE_URL
- SUPABASE_ANON_KEY

The service-role key remains server-only and should never be returned by
api/config.js.

No SQL changes are required.
