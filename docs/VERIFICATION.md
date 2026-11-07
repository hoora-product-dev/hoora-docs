# Delivery verification · 6 November 2026

## Interface and release URL pass

The release feed now shows only date, application/version and an open action. An opened version has a single version rail and All/section tabs above long-form contributions with individual author names. Public release URLs use `/release-notes/<version>/<application>`; old `/docs/<release-slug>` links redirect to the same page. Share links, search results, email previews and browser push use the version URL. Library listing and search exclude releases, which remain in Releases.

The header is 56 px, the sidebar uses neutral selection, and a bundled Lucide icon set replaces prototype icons. Light and dark styles build from one source bundle. The search overlay and document table have tighter spacing and one input border. The explicitly labeled Customer App sample release now has long Markdown content to exercise multi-page reading.

Checks: `npm run check`, `npm test` (23 tests), `npm run knip`, `npm run build`, local `npm run test:browser`, local `npm run test:release-browser`, and local `npm run test:production`. Desktop and 390 px mobile screenshots were reviewed without horizontal overflow or browser exceptions. No email or browser push was sent during verification.

## Implemented and checked

- Four company roles, with manager-owned teams and separate per-team viewer/publisher access. Administrator ownership transfer and manager removal preserve team documents.
- Public, company, team and named-email sharing. Database policies restrict both published pages and drafts. Owners/administrators and the document’s team manager retain appropriate access.
- Stable readable document URLs, clean application/version slugs, preserved old links and native release pages. A release editor focuses on one application/version rather than repeating application tabs.
- Reusable application sections and multiple attributed contributions. Work-in-progress notes stay out of the published snapshot; draft edits do not change published content.
- Markdown visual/source/split/saved preview, HTML upload/paste and full-page isolated interactive rendering.
- Link/provider detection, intentional original-resource fallback and secure embedded PDF navigation/zoom/fullscreen/download.
- Indexed PostgreSQL full-text/prefix/fuzzy search, command overlay keyboard navigation, results filters, related knowledge, personal contributions, recently viewed pages and administrator activity.
- Notification inbox/read state and sender attribution, opt-in browser push, installable app and an atomic three-hour notice cooldown. Private content is not cached offline.
- Administrator archive/restore and permanent deletion including file cleanup. Author removal preserves published attribution.
- Supplied Hoora theme logos, desktop/mobile checks and image conversion/video rejection checks.
- Unused prototypes, legacy source/styles and obsolete test scripts removed. Knip reports no unused files, exports or dependencies in the configured graph.

## Evidence

`npm test`: 22 passing unit tests, including Microsoft token/domain/guest rejection, administrator authorization, announcement restrictions, Markdown sanitization, preview-ticket integrity, provider detection and push endpoint validation.

`npm run test:workflows`: 24 live database/API checks using temporary accounts. Covers cross-team denial, membership/selected-person access, scoped publishing, direct slug queries, public/private storage transitions, archive/restore, preview-ticket revocation, author attribution, draft/publication separation, concurrent cooldown enforcement, and author/manager removal. Temporary content/accounts are cleaned up.

`npm run test:browser`: real browser workflows for manager team creation, people access, Markdown preview/publication, sharing, viewer/anonymous access, keyboard search, link/PDF submission, related knowledge, inbox navigation, manifest/service-worker registration, full-page interactive HTML, administrator archive/restore, permanent file deletion and mobile/dark layouts.

`npm run test:release-browser`: configured application → independent version creation → individual contribution → full-page saved preview → publish → native page. Administrator email template opens with Rahul as the only test recipient; no send action is executed.

`npm run test:uploads`: oversized-dimension PNG becomes compressed WebP at a maximum 1920-pixel edge; video uploads are rejected.

`npm run test:attachments`: visual editor preserves uploaded image and attachment references when serializing Markdown.

`npm run check`, `npm run knip`, `npm run build`: pass. PDF resources are bundled locally and loaded only by PDF views. Listing requests omit full document/contribution bodies; current page content loads on demand. Deployment build clears stale static output.

## External-service boundaries

The existing Microsoft Entra configuration is retained. Automated SSO tests check tenant/domain validation, real-provider-token verification logic and guest rejection. Employee Microsoft login can require that employee’s password/MFA; tests do not bypass it.

No company email was sent during this work. Outlook recipient enforcement remains fixed to Rahul. Email preview is safe to open; actual delivery requires the administrator’s Microsoft Mail.Send consent.

Browser push requires each recipient’s explicit browser permission and a live subscription. Signing keys are configured in protected server storage. Manifest/service-worker readiness and recipient authorization are tested; actual third-party push-service delivery depends on the employee’s browser/network subscription.

Google/Microsoft source permissions remain with their providers. The fallback card is intentional when Hoora cannot safely determine that a private provider document is embeddable.

## Deployment

Application delivery commit: `f036a60`, pushed to `hoora-product-dev/hoora-docs` main and automatically deployed to https://hoora-docs.vercel.app.

Production checks passed for application/section/version navigation, clean document paths, keyboard search, anonymous private-link gates, manifest/icons/service worker, protected API denial and removal of the legacy stylesheet. Continue with Microsoft reached the real Microsoft Entra sign-in service; no employee credentials/MFA were entered.

The full authenticated browser workflow suite and all 24 live API/database checks also passed against the production URL. Production push configuration returns the expected public signing key to authenticated employees, while viewers are denied notice sending and deletion management. No actual email or third-party browser push was sent by the tests.

A subsequent verification-only commit records these results and the production smoke command.
