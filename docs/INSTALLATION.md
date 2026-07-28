# Installation Guide

1. Back up the existing Bluvixa repository.

2. Copy these files into the repository root:
   - `index.html`
   - `domain-manager.css`
   - `domain-manager.js`
   - `api/`
   - `sql/`

3. Keep the existing Bluvixa files beside them:
   - `style.css`
   - `app.js`
   - `platform.js`
   - existing API routes and public-site files

4. In Supabase, open **SQL Editor**, paste `sql/001_custom_domains.sql`, and run it once.

5. In Vercel, add the environment variables listed in `.env.example` to Production, Preview, and Development as appropriate.

6. Create a Vercel access token that can manage the Bluvixa project. Never expose this token in browser JavaScript.

7. Redeploy Bluvixa.

8. Sign in, open **Domains & Publishing**, choose a website, and connect a test domain.

9. Add the DNS records shown by the wizard at the domain registrar.

10. Press **Verify Domain**. Pending domains are rechecked every 30 seconds while the page remains open.

## Required schema assumption

The project table is named `public.website_projects` and uses:
- `id`
- `user_id`
- `name` or `title`
- `slug`
- `published_url` or `public_url`
- `updated_at`

Change the queries in `api/_lib/domain-utils.js` if the production table or ownership column uses different names.


## Hobby plan function limit

This corrected package adds only one Vercel serverless function: `api/domain.js`. The shared helper is stored in `lib/domain-utils.js` and does not create an API endpoint.
