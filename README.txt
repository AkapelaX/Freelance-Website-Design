BLUVIXA 6.2 — STARTER PLAN + CLOUD NOTICE FIX

CHANGES
- The builder reads the signed-in member plan from /api/account.
- Starter members see only Starter in the builder.
- Professional and Advanced are no longer selectable inside the editor.
- Plan changes are managed from Billing.
- New websites, saves, duplicates, and snapshots inherit the account plan.
- The disruptive cloud-project warning popup was removed.
- Temporary cloud-load failures use the local cache and retry silently.

DEPLOY
Replace index.html, style.css, app.js, and platform.js.
Keep the existing api folder and environment variables.
