# Bluvixa 2.5 — Backend-Ready Frontend

This package contains the cleaned Bluvixa 2.5 visual website builder and the backend scaffolding needed for the operating SaaS build.

## Frontend status

- Sample businesses, demo accounts, mock websites, dashboard fillers, simulated analytics, and placeholder billing records have been removed.
- The visual builder opens with blank customer fields.
- Browser preview, design controls, image selection, plan limits, and local draft saving remain available for frontend testing.
- Authentication, account dashboard, cloud saving, Stripe checkout, website buyout, raw-code export, domains, analytics, and publishing are hidden until their live services are connected.

## Backend scaffolding included

- `supabase/schema.sql`
- Supabase authentication and project integration helpers
- Stripe Checkout session endpoint
- Stripe Customer Portal endpoint
- Stripe webhook endpoint
- Account and project API routes
- `.env.example`

## Recommended backend build order

1. Create the production Supabase project.
2. Run `supabase/schema.sql`.
3. Configure authentication and row-level security.
4. Create private/public storage buckets and policies.
5. Add environment variables from `.env.example`.
6. Connect registration, sign-in, verification, password reset, and sessions.
7. Connect project create, save, load, autosave, and media uploads.
8. Configure Stripe products, annual prices, buyout prices, Checkout, Portal, and webhooks.
9. Build publishing, generated-site storage, and version history.
10. Add domain verification, DNS status, SSL, analytics, and raw-code ZIP generation.
11. Unhide each frontend feature only after its complete end-to-end test passes.

## Local frontend test

Serve the folder through a local development server. Do not open `index.html` directly when testing browser file behavior.

## Security

Never expose Supabase service-role keys or Stripe secret keys in frontend JavaScript. Keep privileged operations in server-side API routes and verify ownership on every request.

## Content model update

The builder now uses a simplified content structure:

- One hero headline and one hero bio for every plan.
- One editable heading and one editable description for the main uploads section.
- One editable heading and one editable description for the gallery section.
- Every uploaded image has one description only. Uploads do not have separate titles or bios.
- Older browser drafts are migrated automatically by using the first available legacy title or bio as the new upload description.

Backend records should store section-level headings/descriptions separately from upload-level descriptions.

- Dedicated logo upload tab with live preview and remove control.


## Section media update
- Each content section includes its own optional cover photo.
- Every individual upload accepts either a photo or a video.
- Each upload keeps one description and no separate upload bio.
- Cover photos and upload media are stored in the project state for later Supabase Storage integration.


Final ownership controls added:
- Editable hero tagline
- About section background cover upload
- Editable About heading
- Map section background cover upload
- Editable Map section heading
- All cover photos render as full section backgrounds with readable overlays

## Color controls
The preview theme controls are fully connected:
- Overall page theme: section backgrounds, accents, borders, counters, placeholders, and footer accent.
- Header and footer: navigation header, footer, and map information panel.
- Buttons: all customer-facing call-to-action buttons in the preview.
- Information cards: About information card, featured upload cards, gallery empty/card surfaces, scroll chips, and map frame surface.
- Logo outline: uploaded-logo frame border and glow.

Background cover photos intentionally remain visible; readable overlays are applied above them while cards continue using the selected card color.


## Customer website navigation
- The preview navigation is fixed to Home, About, Services, Display, and Location.
- Each item smoothly scrolls to its matching website section.
- The customer website navigation remains sticky while visitors scroll.


## Frontend console stabilization
- Hidden authentication is not loaded during Live Server frontend testing.
- Optional backend modal controls are null-safe, so removed backend buttons cannot stop the builder JavaScript.
- Enable `auth-payments.js` only when the Vercel API and Supabase environment are running.


## Final frontend navigation

- Home, About, Services, Display, and Location scroll the inner customer website preview.
- The customer website navigation remains sticky while the preview scrolls.
- Navigation uses delegated events so live preview rerenders do not remove its handlers.
- The unused Supabase CDN script is not loaded during frontend-only testing.


## Frontend stabilization release

- Customer preview navigation uses delegated click handling on the preview scroller.
- Home, About, Services, Display, and Location scroll the inner preview to their matching sections.
- The customer navigation remains sticky inside the preview.
- Builder controls, uploads, maps, colors, covers, draft saving, and hidden backend boundaries were preserved.

## Final preview viewport correction
The builder preview height is now responsive to the browser viewport rather than being permanently forced to 820px. This keeps the complete internal scrollbar visible and allows the Location section and footer to be reached without the lower portion of the preview extending beneath the screen.

## Frontend freeze patch

This package includes the final preview-navigation seam correction:

- The preview article has no top padding or margin.
- The sticky customer navigation is flush with the top of the generated site.
- The area underneath the sticky bar inherits the selected header colors.
- CSS and JavaScript URLs include a version query to prevent an older cached file from being reused during testing.

For the cleanest test, close the old Live Server tab, open this folder in VS Code, and start Live Server from this copy.
