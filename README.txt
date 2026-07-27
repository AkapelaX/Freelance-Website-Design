BLUVIXA 11.2.2 — LOGGED-IN LOADING FIX

Fixes the exact issue where Bluvixa opens while logged out but remains stuck on
"Checking your membership..." when an existing session is present.

DEPLOY
Replace:
- index.html
- platform.js

No SQL changes are required.

After Vercel deploys, close every Bluvixa tab and reopen bluvixa.com in a fresh
Safari tab.
