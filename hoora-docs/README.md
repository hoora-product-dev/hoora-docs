# Hoora Docs

Hoora’s knowledge workspace for release notes, SOPs, guides, PDFs, dashboards and standalone HTML artifacts. The interface uses Hoora branding, a GitBook-inspired reader and a locally bundled Tiptap Markdown editor.

## Product workflows

- Public chronological release feed, application-specific version archives, reusable application sections and independently attributed contributions. Only ready contributions enter the published snapshot.
- Visual writing, Markdown source, split preview, saved-draft preview, Markdown import, HTML file upload and direct standalone HTML source paste.
- Link submission with Google/Microsoft/dashboard detection. Resources with provider permission restrictions use an intentional Open Original card rather than a broken iframe.
- Secure PDF upload with embedded page navigation, zoom, fullscreen and download. Images become compressed WebP. Final uploads are limited to 10 MB; video MIME types are excluded from the bucket.
- Public, company sign-in, team-only and selected-work-email access. Owners, the team manager and administrators retain access. A private parent folder/application prevents anonymous reading.
- Managers create teams, invite Hoora emails as team viewers/publishers, publish team knowledge, manage sharing and send in-app notices. Team membership works when an employee later signs in with Microsoft. Team roles do not change company roles.
- Administrators manage company roles, taxonomy, application sections, teams, ownership transfers, archives, permanent deletion, activity and email announcements. Removing an author retains published attribution; removing a manager leaves the team available for administrator reassignment.
- Publishers create and publish company documents. Team publishers contribute only where their team permissions allow. Viewers read permitted published content and can request company publisher access.
- Permission-aware PostgreSQL full-text, prefix and fuzzy search, immediate suggestions, Ctrl/Cmd+K, arrow/Enter navigation, recent searches and a filterable results page.
- Bidirectional related knowledge, actual recently viewed documents, personal contributions and an audit trail without per-edit content snapshots.
- Notification inbox, sender attribution, read state and an atomic three-hour document cooldown. Browser push is opt-in; inactive users and inaccessible documents are excluded. Signing out removes this browser’s subscription.
- Installable web app at `/app`, with a manifest, icons and service worker. Private pages, API responses and documents are never cached for offline reading.
- Human-readable `/docs/page-slug` document URLs and `/release-notes/5.12.0/customer-app` release URLs. Titles can change without breaking old shared document links. Each application has independent versions, with sections and contributor names inside each version. Legacy hash links continue to work.
- Permanent document/project deletion queues storage cleanup and attempts it immediately. Administrators can finish pending deletions from Archive if Storage was temporarily unavailable.

## Authentication and email

Microsoft OAuth uses Supabase Auth with PKCE. The SSO endpoint verifies the Microsoft token through Graph, checks the Entra tenant, rejects guests and requires Hoora work addresses on the backend. New employees receive viewer access. The existing confirmed first-login Hoora password flow and optional password login are retained alongside Microsoft sign-in.

Outlook announcements are administrator-only. The actual test recipient is hardcoded to **rahul@hoora.me**; request-supplied recipients are rejected. Previewing a template does not send email. Company-wide email sending is not enabled. Microsoft Mail.Send consent is obtained through Connect Outlook when an administrator chooses to send a test.

## Architecture

Vercel hosts static browser assets and seven small API routes. Supabase provides Auth, Postgres RLS and a private Storage bucket. No Docker, Redis, Render or persistent application server is needed. The editor, PDF renderer and OAuth assets are local bundles; heavy writing/PDF modules load only when used. Library and release lists fetch metadata rather than every document body. A page’s full content and release contributions load when that page is opened.

The GitBook repository is a design reference, not copied application code. Its hosted editor/content backend is absent from its public repository. See [the architecture decision](docs/GITBOOK-DECISION.md).

## Local development

Use Node.js 22 or newer. Copy `.env.example` to `.env` for a new checkout. This configured workspace already has a populated gitignored `.env`. Never commit `.env`, credentials or private keys.

```sh
npm install
npm run dev
npm run check
npm test
npm run test:workflows
npm run test:browser
npm run test:release-browser
npm run test:uploads
npm run test:attachments
npm run test:production
npm run knip
npm run build
```

The development URL defaults to `http://localhost:3000`. Set `HOORA_TEST_BASE_URL` to the running local server before the live/browser tests. These tests provision temporary Hoora test accounts/content and clean them up; no company email is sent.

```powershell
$env:HOORA_TEST_BASE_URL='http://localhost:3000'
npm run test:workflows
npm run test:browser
```

`npm run db:migrate` applies unapplied SQL migrations transactionally, with a migration lock and a hard project guard for **jrjkxddjwcphdmjeqyfq**. It requires `SUPABASE_DB_PASSWORD` locally. The Supabase MCP connection in this environment targets a different project and must not be used for Hoora changes.

`npm run seed:demo` is idempotent and preserves existing content. Samples have a `sample` tag, explicit labels and fictional contributor names. Administrators can delete them through the application. Do not use the seed script to reset production.

`npm run seed:longform` expands only the explicitly tagged Customer App sample release into a long Markdown example. It checks the Hoora project ID and sample labels before writing. It does not send notifications.

## Deployment

GitHub: `hoora-product-dev/hoora-docs`. Vercel root directory: `hoora-docs`; framework Other; build `npm run build`; output `dist`. GitHub pushes to `main` trigger deployment. The build first removes its fixed output directory, so removed prototype files cannot survive a rebuild.

Required Vercel variables: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `MICROSOFT_SSO_ENABLED`, `MICROSOFT_TENANT_ID` and `ARTIFACT_SIGNING_SECRET`. Entra provider credentials are configured in Supabase Auth. Only the Supabase browser key and URL enter browser configuration.

Browser push signing keys are configured in the private `docs_system_config` table, readable only by the server service role, with the same pair retained in the local `.env`. Optional server variables `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` override that pair; always set both together. A browser must opt in before it receives push. iPhone users must install the app on the Home Screen first.

## Content isolation and operations

HTML artifacts use an opaque sandbox without `allow-same-origin`, forms or top navigation. They can run standalone interactive scripts and load HTTPS resources without accessing the parent application’s session. Five-minute preview tickets recheck current access, active membership, archive state and published revision. Unpublishing, restriction changes and account removal revoke subsequent requests. Previously downloaded or already loaded content cannot be recalled.

Google/Microsoft resource permissions remain with the source provider. Hoora shares a catalog link; it does not grant access in Google Drive or Microsoft 365. Multi-file sites, unbuilt React source, backend services and artifacts requiring embedded secret keys must be exported as standalone HTML first.

Review Supabase/Vercel free-plan usage as content grows. Back up the database and bucket through their supported export tools. Draft and published snapshots are not backups. Preview deployments use their configured database; use a separate project for isolated previews.

Knip’s three unresolved-import exceptions cover generated `/config.js` and the runtime editor/upload bundles in browser tests. The Geist package is used by the font-copy build step. No unused application files/dependencies remain in the configured Knip graph.
