BLUVIXA 11.2.1 — PUBLISH FIX

This fixes the false "Publish failed" result introduced in 11.2.

FIXES
- Media validation no longer treats ordinary saved media records as unfinished.
- Only media explicitly marked uploading, pending, processing, or failed can
  block publishing.
- Live verification now checks the public-site API directly instead of trying
  to verify the rendered HTML page.
- Verification confirms the returned website belongs to the selected project.
- API errors now display the actual server message whenever available.
- If publishing succeeds but verification is temporarily delayed, Bluvixa says
  "Published — verification delayed" instead of incorrectly claiming the whole
  publish failed.
- Keeps the 11.1 login fix and all 11.2 version-history features.

DEPLOY
Replace:
- index.html
- platform.js

No new SQL is required for this correction.

After deploying, redeploy Vercel, close the old browser tab, reopen Bluvixa,
and publish the same website again.
