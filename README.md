# Bluvixa Domains — Full Combined Package

This package supports both:

- Free Bluvixa addresses: `https://bluvixa.com/site/your-business`
- Customer-owned custom domains: `https://yourbusiness.com`

## Included

- Full replacement `index.html`
- Full replacement `style.css`
- `domain-manager.js`
- One Hobby-plan-safe serverless function: `api/domain.js`
- Shared server helper: `lib/domain-utils.js`
- Corrected SQL migration using `owner_id`
- Installation documentation

## Before replacing files

Back up the production repository.

Delete obsolete domain endpoints if they still exist:

- `api/connect-domain.js`
- `api/check-domain.js`
- `api/remove-domain.js`
- `api/domain-status.js`
- `api/domain-search.js`
- `api/domain-utils.js`
- `api/_lib/domain-utils.js`

Keep only `api/domain.js` for this domain feature.

## Existing files that remain required

The supplied `index.html` still loads:

- `app.js`
- `platform.js`
- Supabase browser library
- existing assets and favicon files

Do not remove those existing files.

## Environment variables

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `VERCEL_TOKEN`
- `VERCEL_PROJECT_ID`
- `VERCEL_TEAM_ID` only for a team-owned Vercel project

## Important

Test with a spare domain before customer use. Never delete MX records used for business email.
