BLUVIXA 5.0 — MULTI-WEBSITE WORKSPACE

THIS IS A COMPLETE FRONTEND WORKSPACE UPDATE

SIGNED-IN PAGES
- My Websites
- Saved Drafts
- Website Builder
- Billing & Ownership
- Domains & Publishing

MY WEBSITES
- Members can create as many local website projects as desired.
- Every website begins as a draft.
- Websites can be edited, duplicated, deleted, and marked for publishing.
- Each website stores its own plan, website state, URL settings, publishing status,
  ownership status, and timestamps.
- The current project is loaded into the existing visual builder and preview.

SAVED DRAFTS
- Shows all website projects, including incomplete websites.
- Shows manual snapshots saved from the builder.
- Supports search and filters.
- Website projects can be loaded, duplicated, bought out, or exported after ownership.
- Buyout prices are displayed per website:
  Starter $499, Professional $599, Advanced $699.
- Snapshots can be loaded or deleted.

BILLING & OWNERSHIP
- Clearly separates subscription access from website ownership.
- Explains that subscriptions provide platform access.
- Explains that each buyout belongs to one specific website.
- Explains that ownership is permanent after the backend records it.
- Explains that hosting and domain registration are separate from code ownership.

DOMAINS & PUBLISHING
- Generates domain suggestions immediately.
- Attempts POST /api/domain-search for live provider results.
- Reserves a per-project Bluvixa subdomain in the frontend workspace.
- Stores custom-domain connection requests per project.
- Displays DNS preparation records.
- Shows every website’s publishing state.
- Real public deployment still requires the publishing backend and wildcard routing.

PRESERVED SUPABASE AND STRIPE SETTINGS
- /api/config
- Supabase authentication
- /api/account
- /api/project
- /api/create-checkout-session
- /api/create-portal-session
- /api/export-website
- Existing environment variables and webhook settings are not embedded or replaced.

BACKEND PAYLOAD UPDATE
For per-website buyouts, /api/create-checkout-session now receives:
  websiteId: the selected website project ID

The Stripe webhook should save the ownership result against that website record, not
only as a single account-wide boolean. The existing account-wide fields can remain
for backward compatibility.

LOCAL STORAGE NOTE
This frontend demonstrates the complete multi-website experience using browser
storage. Production should move projects, snapshots, ownership records, domains, and
publishing records into Supabase tables so they synchronize across devices.
