BLUVIXA 12.1 — HOBBY PLAN CLEAN DEPLOY

WHY THE LAST DEPLOYMENT FAILED
Vercel rejected the deployment because the GitHub repository still contained
more than 12 files inside the api folder. Since the deployment failed, Bluvixa
continued serving the previous broken deployment.

IMPORTANT: DO NOT MERGE THIS PACKAGE INTO THE OLD API FOLDER.

DEPLOY STEPS
1. In the GitHub/Vercel project, delete the ENTIRE existing api folder.
2. Commit that deletion if GitHub asks you to.
3. Copy the api folder from this package into the project.
4. Replace the matching frontend files with the files from this package.
5. Do not upload .env.local. Keep secrets in Vercel Environment Variables.
6. Commit and push.
7. Confirm the Vercel deployment says Ready, not Error.
8. Sign out of Bluvixa, close the browser tab, reopen it, and sign in.

THIS PACKAGE CONTAINS 9 SERVERLESS ENDPOINTS
- account
- config
- connect-domain
- create-checkout-session
- create-portal-session
- export-website
- public-site
- publish-site
- stripe-webhook

The _lib.js file is a shared helper, not an endpoint.

REMOVED
- domain-search.js was removed because it is optional and generated domain
  suggestions already work in the frontend without it.
- The Vercel CLI devDependency was removed to eliminate the build warning.

DO NOT LEAVE OLD ROUTES SUCH AS THESE IN api/
- dashboard.js
- project.js
- export_website.js
- duplicate copies with (1), (2), or (3) in their names
- old account, checkout, publishing, or webhook files

A successful deployment is required before any account/API fix can appear live.
