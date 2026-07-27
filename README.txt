BLUVIXA 11.2 — PUBLISHING RELIABILITY

NEW
- Verifies the public URL before showing "Website verified live."
- Creates Published Version 1, 2, 3, and so on after successful verification.
- Restores published versions into the builder for review and republishing.
- Shows precise failures for Save, Media, Build, Deploy, and Verification.
- Prevents double publishing by disabling the Publish button during the job.
- Warns when builder changes are newer than the verified live version.
- Uses real publishing stages instead of a decorative progress animation.
- Keeps the 11.1 membership/login fix.

DEPLOY
Replace the complete package, or at minimum:
- index.html
- style.css
- platform.js

The existing API routes remain included.

SQL
Run SUPABASE-11.2-PUBLISHING-RELIABILITY.sql to prepare a secure
server-backed publish-history table. The current release also keeps immediate
version history locally so the feature works as soon as it is deployed.

TEST
1. Publish a draft.
2. Confirm Publish disables while working.
3. Confirm success appears only after the live URL responds.
4. Edit the project and confirm the Unpublished Changes warning appears.
5. Publish again and confirm Published Version 2 appears.
6. Restore Published Version 1 and review it in the builder.
