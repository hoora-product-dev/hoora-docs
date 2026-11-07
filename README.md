# Hoora Docs

Hoora’s workspace for release notes, documentation and operating procedures.

[Website](https://hoora-docs.vercel.app) · [Install](https://hoora-docs.vercel.app/install) · [Upcoming releases](docs/upcoming-releases.md) · [Verification](docs/UI-REFINEMENT.md)

## Features

- Platform releases with readable version URLs, section filters and individually attributed contributions.
- Full-page Markdown writing, source and preview modes; clipboard/drop image uploads; private PDFs; standalone HTML artifacts; link previews; and editable Excalidraw diagrams.
- Public, company, team and selected-email sharing, enforced by database and Storage policies.
- Microsoft work-account sign-in, permission-aware search, an assistant with cited sources, opt-in browser push and an installable web app.
- Approved stakeholder access to upcoming Jira releases, with Vertical and Product Owner filters. Administrators configure the date, version, saved filter and viewer list.

Dark mode is the default. Locally bundled Geist, neutral controls and shared layout tokens keep desktop and mobile views consistent. The supplied Hoora logo retains its original color.

## Development

Requires Node.js 22 or newer and npm.

```sh
npm ci
cp .env.example .env
npm run dev
```

Populate `.env` with the appropriate project credentials. Never commit it. Development defaults to `http://localhost:3000`; set `PORT` to use another port.

```sh
npm run check
npm test
npm run knip
npm run build
```

Browser/integration tests need a running server. Set `HOORA_TEST_BASE_URL` to its address. Live tests create temporary accounts/content and clean up their own records; use an isolated test project when available. Migration and live-test scripts include Hoora project guards.

| Command                        | Coverage                                                                         |
| ------------------------------ | -------------------------------------------------------------------------------- |
| `npm run test:browser`         | Teams, sharing, search, uploads, PDFs, HTML, notifications and archive workflows |
| `npm run test:release-browser` | Release creation, full-page contributions, preview and publishing                |
| `npm run test:editor`          | Clipboard compression, preview round trips and drawing export                    |
| `npm run test:interactions`    | Hover, stable controls, sidebar, mobile drawer and assistant                     |
| `npm run test:ui`              | Public/admin page geometry and screenshots at six viewport widths                |
| `npm run test:workflows`       | Database permissions and content lifecycle integration                           |
| `npm run db:migrate`           | Ordered, transactional migrations with a project guard and migration lock        |

## Structure

```text
api/                  Vercel HTTP endpoints
server/               Shared identity, Jira, email and link helpers
public/
  app.js              Routing and application integration
  editor/             Contribution pages, clipboard uploads and drawing assets
  pages/              Page renderers
  ui/                 Navigation, feedback and safe previews
  *.js                Feature modules, PWA and service worker
src/
  styles/             Shared tokens, layouts and component styles
  rich-editor.js      Tiptap Markdown editor
  drawing.js          Lazily loaded Excalidraw workspace
  uploads.js          Image preparation and upload validation
scripts/              Build, development, migration and maintenance commands
supabase/migrations/  Versioned schema, permissions and database functions
tests/                Unit, security, browser and integration checks
docs/                 Architecture decisions and delivery evidence
```

The application lives directly at the repository root. Dependencies, local fonts, `public/vendor`, `dist` and test artifacts are generated or ignored. The build clears `dist` before copying current assets. Heavy editor, drawing and PDF modules load when used.

## Content and storage

| Data                             | Location                                                                                                   |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Markdown and document metadata   | Postgres `docs_pages` draft row                                                                            |
| Published document               | `docs_published`, a separate published snapshot                                                            |
| Individual release contributions | `docs_entries`; ready contributions enter the published release snapshot                                   |
| Images, PDFs, HTML and drawings  | Private Storage bucket `hoora-docs`, under the owning document/release ID                                  |
| Retrieval index                  | Postgres `docs_ai_chunks`: pgvector embeddings with 1,536 dimensions, section text and revision references |
| Jira tickets                     | Read from Jira on demand; not copied into Supabase or the assistant index                                  |

Pasted Markdown is database text, rather than a second `.md` object. Drafts, published snapshots and retrieval chunks serve different purposes. Index refresh replaces a document’s previous chunks. Images become WebP at a maximum dimension of 1,920px before upload; the final file limit is 10 MB. Drawings keep private editable source alongside a raster preview.

Vectors share Postgres capacity with other rows; binary files use the separate Storage quota. Actual limits and usage depend on the project’s current Supabase plan and dashboard. Published snapshots and indexes are not backups.

## Access boundaries

Company roles are administrator, manager, publisher and viewer. Team viewer/publisher roles are separate; members may grant only equal or lower team access. Database policies remain authoritative for reading, editing, publishing and attachments.

Microsoft sign-in uses Supabase OAuth with PKCE and server-side tenant/member verification. New employees receive viewer access and complete Hoora password setup. Email/password login remains available after setup; the Hoora password does not change the Microsoft password.

HTML artifacts run in an opaque sandbox without parent session access or top navigation. Short-lived preview tickets recheck authorization. Markdown excludes executable HTML. YouTube previews load from an approved embed host after a click. Drawing imports reject external image sources and executable hyperlinks. The service worker does not cache private documents or API responses offline.

Push requires browser permission and a subscription; installation alone cannot grant permission. iOS web push requires a Home Screen installation. Signing out removes the browser subscription. Email previews do not send mail; administrator test announcements have a fixed test recipient.

## Deployment

Production runs on Vercel from `hoora-product-dev/hoora-docs`, branch `main`.

| Setting          | Value                          |
| ---------------- | ------------------------------ |
| Root directory   | Repository root; leave blank   |
| Framework        | Other                          |
| Install command  | `npm install --ignore-scripts` |
| Build command    | `npm run build`                |
| Output directory | `dist`                         |

See [.env.example](.env.example) for configuration. Only the Supabase URL, public browser key and Microsoft-enabled flag enter browser configuration. Service-role, Microsoft, Jira, AI Gateway and signing credentials stay server-only.

Push uses a matched VAPID key pair from private server configuration or environment overrides. The assistant uses Vercel AI Gateway; its generation model is configured in `api/assistant.js`. See [Upcoming releases](docs/upcoming-releases.md) for Jira token scope, field mapping and rotation.

Apply migrations before deploying dependent code. Preview deployments use the database configured in their environment; use a separate Supabase project for isolation. Keep database and Storage backups through supported export tools.

## Maintenance

- [UI refinement and verification evidence](docs/UI-REFINEMENT.md)
- [Upcoming Jira releases](docs/upcoming-releases.md)
- [Content architecture decision](docs/GITBOOK-DECISION.md)
- [Earlier delivery verification](docs/VERIFICATION.md)

Seed commands are explicit maintenance tools, not production reset commands. Preserve migration history and authored company documents when cleaning samples. Dependency audits and Knip complement browser and permission tests.

Maintained by [Rahul Tripathi](https://rahul-tripathi.web.app). Licensed under [MIT](LICENSE).
