# Deployment Notes

## Vercel

The APIs use the Vercel REST API to add, inspect, verify, and remove project domains.

Environment variables:
- `VERCEL_TOKEN`
- `VERCEL_PROJECT_ID`
- `VERCEL_TEAM_ID` when using a team-owned project

The token must have access to the project named by `VERCEL_PROJECT_ID`.

## Automatic verification

The browser calls `check-domain.js` when the user clicks Verify or Retry. While a domain remains pending and the Domain page is open, it also refreshes every 30 seconds.

A scheduled backend verification job is intentionally not included. The current package performs user-driven and open-page verification without requiring cron infrastructure.

## HTTPS

No certificate files are stored in Bluvixa. Vercel provisions and renews HTTPS for verified project domains.

## Cloudflare

Cloudflare remains the DNS provider. The customer adds the DNS records there. Bluvixa does not need Cloudflare API credentials for this workflow.
