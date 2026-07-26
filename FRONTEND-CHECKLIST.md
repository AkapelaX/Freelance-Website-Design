# Bluvixa 2.5 Frontend Handoff

## Complete
- Public SaaS marketing sections
- Subscription versus website-buyout explanation
- Raw-code ownership terms
- Blank visual builder
- Responsive website preview
- Plan-based frontend limits
- Local draft save/load
- Sample and demo content removed
- Backend-dependent interface hidden

## Activate only after backend completion
- Authentication and account recovery
- Customer dashboard
- Cloud project persistence
- Media storage
- Stripe subscriptions and billing portal
- Website buyouts and entitlement checks
- Domain management
- Publishing and version history
- Analytics
- Raw-code ZIP generation and downloads

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


## Stabilization verification
- [x] Preview navigation targets exist and are uniquely identified.
- [x] Preview navigation is delegated so rerenders do not remove handlers.
- [x] Preview navigation scrolls the inner preview container.
- [x] Sticky customer navigation remains enabled.
- [x] JavaScript syntax validated.
- [x] HTML IDs checked for duplicates.
- [x] All required builder IDs referenced by app.js are present, except optional hidden backend controls.
