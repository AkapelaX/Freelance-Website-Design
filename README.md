# Bluvixa Master Corrected Package

This package consolidates the Bluvixa frontend and backend around the canonical Supabase schema.

## Structure

- `index.html` — Bluvixa landing page, member dashboard, domains, billing, and builder shell.
- `app.js` — one master frontend script containing platform/auth, dashboard, domain manager, publishing, and builder behavior.
- `public-site.html` — one self-contained renderer for published and exported websites.
- `style.css` — complete Bluvixa application styling.
- `api/api.js` — one master API function using action-based routing.
- `api/stripe-webhook.js` — separate Stripe webhook function with raw-body parsing.
- `lib/server.js` — server-only Supabase, Stripe, authentication, and response helpers.
- `supabase-schema.sql` — canonical Supabase schema with per-project website buyout fields.

Vercel sees only **two serverless functions**:

1. `/api/api.js`
2. `/api/stripe-webhook.js`

## Master API endpoints

The frontend uses `/api/api?action=...`:

- `config`
- `account`
- `projects`
- `delete-project`
- `publish`
- `public-site`
- `domain` with `domain_action=status|check-slug|reserve-slug|connect|check|remove`
- `domain-search`
- `checkout`
- `portal`
- `export`

## Setup

1. Run `supabase-schema.sql` in Supabase SQL Editor.
2. Copy every variable from `.env.example` into Vercel Project Settings → Environment Variables.
3. Deploy the whole folder to Vercel.
4. In Stripe, set the webhook endpoint to:

   `https://YOUR-DOMAIN/api/stripe-webhook`

5. Subscribe the Stripe webhook to:

   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`
   - `invoice.payment_succeeded`

## Database contract

All website projects use:

- table: `public.projects`
- owner: `user_id`
- website data: `project_data`
- publish state: `published`
- public link: `published_url`

Do not recreate `website_projects`, `owner_id`, or text-based project `status` fields.

## Local syntax check

```bash
npm install
npm run check
```

The Stripe and Vercel integrations require real environment variables and cannot be fully tested by syntax checking alone.
