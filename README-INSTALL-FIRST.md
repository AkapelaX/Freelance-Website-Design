# Bluvixa Full Production Root Package

This ZIP is intentionally packaged with all project files at the ZIP root. Extract it directly into the root of the Git repository so `api`, `supabase`, `index.html`, `app.js`, and `vercel.json` sit beside one another.

## Correct repository layout

```
Freelance-Website-Design/
├── api/
│   ├── config.js
│   ├── health.js
│   ├── account.js
│   ├── projects.js
│   ├── public-site.js
│   ├── publish-site.js
│   ├── create-checkout-session.js
│   ├── create-portal-session.js
│   ├── export-website.js
│   ├── domain.js
│   ├── stripe-webhook.js
│   ├── _lib.js
│   └── _internal/
├── supabase/
│   └── schema.sql
├── index.html
├── public-site.html
├── app.js
├── style.css
├── package.json
├── vercel.json
├── .gitignore
└── .env.example
```

## Install

1. Delete the old tracked project files from the Git repository, but keep the hidden `.git` folder.
2. Open this ZIP and copy **everything inside it** into the repository root. Do not copy an extra outer folder.
3. Confirm GitHub will show `api` and `supabase` at the same level as `index.html`.
4. In Supabase SQL Editor, run `supabase/schema.sql` once against the intended production project.
5. Add the required values from `.env.example` under Vercel Project Settings → Environment Variables. Never commit real values.
6. Commit and push:

```powershell
git add .
git commit -m "Install complete Bluvixa production package"
git push origin main
```

7. After deployment, test:

- `/api/health` — reports only whether required environment variables exist.
- `/api/config` — returns the Supabase URL and anon/public key needed by browser authentication.
- Sign in and create an account from the Bluvixa interface.

## Security

The ZIP contains no live keys. Keep secret keys only in Vercel Environment Variables. The Supabase server key, Stripe secret key, webhook secret, and Vercel token must never appear in frontend JavaScript or Git.
