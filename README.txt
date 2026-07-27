BLUVIXA 8.0 — AUTOSAVE + RECOVERY CLOUD WORKSPACE

Built from the confirmed-working Bluvixa 7.2 cloud-save package.

NEW IN 8.0
- Automatic cloud save after the customer stops editing for about 1.6 seconds.
- Live save status: Unsaved changes, Saving to cloud, All changes saved to cloud,
  or Cloud save needs attention.
- Manual Save Website still works and waits for Supabase confirmation.
- The active project ID is remembered.
- Returning directly to #builder reopens the last active cloud project.
- Project state is cached locally as an emergency browser recovery copy.
- Leaving or backgrounding the page triggers a final autosave attempt.
- Existing My Websites, Saved Drafts, Starter-plan lock, RLS, Stripe, publishing,
  domains, buyout, and export wiring remain intact.

DEPLOYMENT
Replace:
- index.html
- style.css
- app.js
- platform.js

Keep:
- your existing api folder
- Supabase environment variables
- Stripe environment variables and webhook
- the existing website_projects table, grants, and RLS policies

TEST
1. Deploy to Vercel.
2. Sign in and open a website.
3. Change the business name.
4. Wait about two seconds.
5. Confirm the status reads “All changes saved to cloud.”
6. Refresh the page and reopen the website.
7. Confirm the change remains.
