BLUVIXA 11.1 — PUBLISHING CENTER LOGIN FIX

This update fixes the screen remaining stuck on:
"Checking your membership…"

FIXES
- The loading screen now closes as soon as Supabase determines whether a
  session exists.
- Account and cloud-project checks no longer block the login interface.
- Network timeout protection was added for configuration, session, account,
  and workspace loading.
- Local saved projects are shown if the cloud request is temporarily slow.
- The authenticated publishing API helper now runs inside the platform
  controller, where it can correctly access the Supabase session.
- A new script version prevents the browser from serving the broken cached
  platform.js file.

DEPLOY
Replace these files:
- index.html
- platform.js

The full package is included, but no SQL or environment-variable changes are
required.

After deployment, redeploy Vercel and refresh the website. On iPhone, close the
browser tab and reopen Bluvixa to ensure the corrected JavaScript loads.
