# Bluvixa Custom Domain Manager

This package adds a self-contained custom-domain workflow to the existing Bluvixa single-page application.

## Included

- Full replacement `index.html` based on the supplied Bluvixa file
- `domain-manager.css`
- `domain-manager.js`
- Connect Domain wizard
- DNS instructions
- Live status badges:
  - Not Connected
  - Verifying
  - Connected
  - Needs Attention
- SSL status
- Copy DNS record buttons
- Remove Domain
- Retry Verification
- 30-second automatic status refresh while pending
- Publishing Center domain and SSL integration
- Authenticated Vercel API routes
- Supabase SQL migration
- Installation documentation

## API routes

- `POST /api/connect-domain`
- `POST /api/check-domain`
- `POST` or `DELETE /api/remove-domain`
- `GET /api/domain-status`
- `GET /api/domain-status?project_id=...`

All routes require a valid Supabase bearer token. The service-role key and Vercel token remain server-side.

## How routing works

All customer domains are assigned to the same Bluvixa Vercel project. The existing `index.html` host redirect forwards unknown hostnames to `public-site.html?host=...`, where Bluvixa can load the website project associated with the request hostname.

## Vercel and HTTPS

Vercel applies a configured custom domain to the latest production deployment and handles HTTPS certificate provisioning after domain verification. Third-party domains still require DNS configuration at their registrar.

## Cloudflare compatibility

A domain registered or DNS-hosted at Cloudflare can be connected by adding the records shown by Bluvixa. During initial verification, set a relevant CNAME record to **DNS only** if proxying prevents Vercel from validating it. After Vercel reports the domain as connected, Cloudflare proxy behavior can be tested carefully.

## Production cautions

- Test with a spare domain before offering this to customers.
- Do not delete MX records used for email.
- Vercel account and project domain limits still apply.
- Wildcard domains require a different nameserver-based workflow and are not included in this package.
- Domain purchase/registration is not included; this package connects domains customers already own.
- Confirm the exact `website_projects` schema before deployment.
