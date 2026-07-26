# Bluvixa 2.5 — Complete Backend Starter

This package preserves the finished visual builder and adds the files needed to begin the real Supabase/Vercel backend.

## What is active in this starter

- Supabase sign up, sign in, sign out, email verification, and password reset UI
- Authenticated cloud project save/load through `/api/project`
- Account status through `/api/account`
- Existing local drafts remain available as a fallback
- Stripe server routes are included but remain unconfigured until Stripe price IDs are added
- Publishing and raw-code export stay locked for later phases

## 1. Install

Open this folder in VS Code, then run:

```bash
npm install
```

## 2. Configure environment variables

Copy `.env.example` to `.env.local` and enter your real values.

Required now:

- `SUPABASE_URL`: `https://YOUR_PROJECT_REF.supabase.co`
- `SUPABASE_ANON_KEY`: your `sb_publishable_...` key
- `SUPABASE_SERVICE_ROLE_KEY`: your server-only service-role or new secret key

Never expose `SUPABASE_SERVICE_ROLE_KEY` in HTML, screenshots, GitHub, or browser JavaScript.

Stripe values can remain placeholders until the billing phase.

## 3. Create the database

In Supabase:

1. Open **SQL Editor**.
2. Create a new query.
3. Paste all of `supabase/schema.sql`.
4. Click **Run**.

This creates user profiles, one cloud website project per user, media metadata, export records, RLS policies, the auth trigger, and the private `website-media` Storage bucket.

## 4. Configure Auth URLs

In Supabase Authentication URL configuration, add:

- Local Site URL: `http://localhost:3000`
- Local Redirect URL: `http://localhost:3000/**`
- Production Site URL: your Vercel URL
- Production Redirect URL: `https://YOUR-VERCEL-DOMAIN/**`

## 5. Start correctly

Use:

```bash
npm run dev
```

Do **not** use Live Server for backend testing. Live Server cannot run `/api/config`, `/api/project`, or the other Vercel server routes.

Open the localhost URL printed by `vercel dev` (normally `http://localhost:3000`).

## 6. First test

1. Click **Sign In** or **Start Free Trial**.
2. Create an account.
3. Verify the email if confirmation is enabled.
4. Sign in.
5. Edit the website.
6. Use **Save to Cloud**.
7. Refresh and use **Load from Cloud**.

## 7. Vercel deployment

Add the same environment variables under Vercel Project Settings > Environment Variables, then deploy.

## Security boundary

- Publishable key: browser-safe only with RLS.
- Service-role/secret key: server only.
- Stripe secret and webhook secret: server only.
- All user project routes verify the Supabase access token before reading or writing.

## Locked pricing

- Starter: $15/month equivalent, $180/year, $499 buyout
- Professional: $29/month equivalent, $348/year, $599 buyout
- Advanced: $49/month equivalent, $588/year, $699 buyout
