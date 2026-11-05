# Hoora Docs

Hoora's public knowledge hub and private publishing workspace for release notes, SOPs, and documentation, organized by vertical and folder.

## Lightweight Hub direction

The application is a static Vercel site with small serverless endpoints. Supabase stores content, authentication records, permissions, and uploads. GitBook Open is used as a reading-design reference only; its hosted writing and management backend is absent from that repository. Hoora uses a locally bundled Tiptap editor for visual Markdown writing and keeps Markdown as the document source. The editor bundle loads only on writing screens.

Public release notes have a chronological feed and a full page for each application version, with contributor sections, author names, version navigation, and an on-page outline. Application sections are reusable across versions. The additive `202611060001_project_sections_and_publisher.sql` migration adds per-application section configuration and publisher attribution; apply it to the correct Supabase project before enabling those controls. The UI retains a global-section fallback while that migration is pending.

The target access model is administrator, manager, publisher, and viewer, including person-specific access for restricted documents. That scoped authorization model is still being developed; the current database continues to use its existing roles and policies. Do not treat UI visibility as an authorization boundary. Email announcements remain test-only and fixed to `rahul@hoora.me`.

See `docs/GITBOOK-DECISION.md` and `docs/LIGHTWEIGHT-HUB.md` for the architecture decision and migration sequence.

## Architecture

- Vercel hosts the static interface and the server API functions for user management, onboarding, artifact previews, and Outlook announcements.
- Supabase provides PostgreSQL, email/password authentication, and a private `hoora-docs` storage bucket.
- No Docker, Redis, local database, or persistent application server is required.
- This is a purpose-built application implementing the requested documentation workflows, not a full Docmost distribution. Upstream Docmost source remains in the parent directory of the original local workspace. Live cursor collaboration, Docmost plugins, enterprise integrations, and the full Docmost editor are not included.
- The interface uses a self-hosted Geist font. Marked and DOMPurify handle Markdown, and Supabase Auth handles Microsoft OAuth with PKCE. Browser assets are bundled locally using esbuild; no design CDN is required.

## Development

Use Node.js 24 or newer. From the `hoora-docs` directory, install dependencies and copy `.env.example` to `.env`. The configured local workspace already has a populated, gitignored `.env`. Never commit this file or administrator credentials.

```sh
npm install
npm run dev
npm run check
npm test
npm run build
```

Open http://localhost:3000. Drafts, users, shared releases, approval requests, and uploads are always stored in Supabase. Only the authentication session is cached in the browser.

## Deployment

Import `hoora-product-dev/hoora-docs` into Vercel. Set **Root Directory** to `hoora-docs`, framework **Other**, build command `npm run build`, output directory `dist`, and Node.js 24. The committed `vercel.json` supplies the build settings. Set the following environment variables for Production and Preview:

| Variable                    | Purpose                                                                                   |
| --------------------------- | ----------------------------------------------------------------------------------------- |
| `SUPABASE_URL`              | Supabase project's API URL                                                                |
| `SUPABASE_ANON_KEY`         | Publishable/anonymous key used with row-level security                                    |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only key for administrator user management                                         |
| `MICROSOFT_TENANT_ID`       | Hoora's Microsoft Entra tenant, used for server-side membership verification              |
| `MICROSOFT_SSO_ENABLED`     | Set to `true` to show Microsoft sign-in                                                   |
| `MICROSOFT_CLIENT_ID`       | Entra app registration identifier, also configured in Supabase                            |
| `ARTIFACT_SIGNING_SECRET`   | Random server-only secret, at least 32 characters, for short-lived artifact preview links |

Only the URL, anonymous key, and Microsoft-enabled flag are written to browser configuration. Never prefix server secrets with `PUBLIC`, `NEXT_PUBLIC`, or `VITE`. `MICROSOFT_CLIENT_SECRET` is stored in the local `.env` and in Supabase's Azure provider configuration. It is not required by the Vercel application because Supabase handles the OAuth token exchange. Its current expiration is **May 4, 2027**; rotate it in Entra and Supabase before that date.

Connect the Vercel project's Git integration to the GitHub repository with `main` as the production branch. Every push to `main` deploys production; pull requests create previews. The initial schema is in `supabase/migrations/202611040001_hoora_docs.sql`. Apply future migrations explicitly before deploying code that depends on them; builds intentionally do not run database migrations.

Set Supabase's Site URL to the production deployment. OAuth account creation must be enabled for first-time Microsoft sign-ins; the interface does not offer password signup, and an Auth account alone grants no team access. The server provisions membership only after Microsoft account verification. Existing administrator-created password accounts remain available. Administrators manage roles, access, and password accounts from **Workspace → Team members**.

## Microsoft Teams account sign-in

The application uses the Microsoft Entra work account behind Teams, through Supabase's Azure OAuth provider. The Entra app is single-tenant, with Supabase's callback `https://jrjkxddjwcphdmjeqyfq.supabase.co/auth/v1/callback`. Azure provider configuration uses the tenant-specific URL `https://login.microsoftonline.com/e990c26c-1489-4803-b7f2-dc1cf4cac0bf`.

The callback uses PKCE. `/api/sso` checks the Supabase identity, validates the Microsoft access token through Microsoft Graph, compares the immutable Microsoft subject, checks the tenant, and rejects guest accounts. A verified new employee receives **viewer** access. Existing roles are preserved. Roles are controlled in Hoora Docs rather than synchronized from Entra groups. `rahul@hoora.me` is the verified setup owner's administrator account; the original password administrator is retained.

Disabling a member revokes database and private artifact access even if an existing token has not expired. Removing a Microsoft member also blocks their Microsoft subject from automatically rejoining. To restore a removed member, an administrator can explicitly create an account with their email, which clears the block. No Microsoft Graph application permissions or organization-wide directory access are used by the Hoora Docs app; the signed-in user's profile is requested during login. Connecting Outlook separately requests delegated Mail.Send; no directory enumeration or application-level mail permission is used.

## Roles and publishing

| Role      | Read internal | Edit drafts and folders | Publish / unpublish | Manage verticals | Manage users |
| --------- | ------------- | ----------------------- | ------------------- | ---------------- | ------------ |
| Viewer    | Yes           | No                      | No                  | No               | No           |
| Editor    | Yes           | Yes                     | No                  | No               | No           |
| Publisher | Yes           | Yes                     | Yes                 | Yes              | No           |
| Admin     | Yes           | Yes                     | Yes                 | Yes              | Yes          |

All active team members can read all internal documents. Vertical-specific membership restrictions are not implemented. Only administrators and publishers may delete documents. At least one active administrator must remain.

Saving changes writes to `docs_pages`. Publishing explicitly copies that revision to `docs_published`, which is the only document table anonymous readers can read. Draft edits to published pages stay private until republished. Edit rollback history is disabled and its stored snapshots were deleted. Product release versions remain. Concurrent saves use revision checks to prevent overwriting another editor's work.

Uploads are limited to 10 MB per file; videos are not accepted and an allowlist of document/image types. Files remain in a private bucket. Anonymous readers can download a file only while its exact attachment reference appears in a published document. Unpublishing revokes subsequent public downloads; copies already downloaded by visitors cannot be recalled. Deleted documents may leave inaccessible orphan objects in Storage; administrators can clean them from the Supabase dashboard.

## Content and organization

Create verticals for teams or product areas. Create folders for internal organization, then select a folder in the document editor to move a document. Public visitors navigate by content type and vertical. Markdown supports headings, emphasis, tables, lists, links, quotes, images, and code blocks. Raw HTML is escaped and the generated output is sanitized. Paste Markdown into the editor, use **Import .md**, or choose **Import file** in the workspace. Write, Split view, and Preview modes show the formatted result. File attachments are downloaded; remote HTTPS images in Markdown can render inline.

## HTML artifacts

Choose **Import file** and select a standalone `.html` or `.htm` file, or select **HTML artifact** in an existing document's editor. The file is stored privately in Supabase and rendered in a browser-style preview. Open it as a full page, reload it, or download the original HTML. HTML files and other attachments are limited to **10 MB per upload**. Artifact responses stream through Vercel; uploads go directly to Supabase. Replacing a file creates a new storage path so draft changes never overwrite the published HTML.

Both the iframe and the HTML response enforce a sandbox without `allow-same-origin`. Interactive JavaScript can run, but it cannot access the parent app's DOM, session storage, cookies, or local storage. HTTPS scripts, styles, fonts, and images can load for common standalone AI exports. Forms and top-level navigation are disabled. Multi-file sites, relative local asset folders, servers, React/TSX source without an HTML build, and artifacts requiring secret API keys are not standalone HTML and must be exported/built before upload.

`/api/artifact` issues five-minute signed preview tickets. Every request checks the current published snapshot or active team membership. Unpublishing or disabling a member revokes subsequent access even to an already-issued ticket. An already loaded browser page or downloaded file cannot be recalled. Never remove the artifact endpoint's sandbox header or add `allow-same-origin` to its iframe.

## Validation

`npm test` covers Markdown sanitization, admin authorization, SSO provisioning, and artifact tickets. To run the explicit live artifact checks against this project's database, start the app and run `node tests/live-artifact.mjs`. Use `HOORA_TEST_BASE_URL` to select a local or production base URL. This script creates temporary test data and removes it afterward. The fixtures include a standalone interactive HTML example and a Markdown import example.

## Operational checks

- Run unit tests and a production build before each release.
- Test anonymous draft denial, editor publishing denial, and disabled-user denial after policy changes.
- Review Supabase authentication limits and database/storage usage as the team grows.
- Export/backup the database and bucket using Supabase's supported tools. The current draft and published copy are not backups.
- Preview deployments share the configured database. Use a separate Supabase project if previews must be isolated from production data.

## Shared releases and review

Release collections represent applications such as Customer App and Admin Panel. Administrators and publishers create one release per collection/version pair. Editors add separate attributed contributions under verticals, with ticket references and a Work in progress / Ready status. Editors may edit their own contributions; publishers and admins may edit any. Publish aggregates only ready contributions into a public snapshot grouped by vertical. Saving a contribution never changes the existing public release.

Public visitors can browse release collections without signing in. Folders organize ordinary SOPs and documents internally. Published documents and releases can be unpublished or permanently deleted by an admin or publisher. Deleting a release cascades its contributions. There is no rollback archive. Concurrent edits use revision counters only.

Viewers request editor access from My account. Editors request publication from a document or release. Requests & approvals contains the review queue; only admins approve access, and admins/publishers approve publication. An approval publishes the current draft at the time of approval.

## First login and themes

New Microsoft employees receive viewer access and must create a Hoora Docs password with confirmation before entering the workspace. This is separate from their Microsoft password. After setup, Microsoft sign-in and email/password both work. Existing password accounts are retained. Both rahul@hoora.me and harsh@hoora.me are administrators. Light/dark theme selection persists in the browser and defaults to the operating system preference.

## Upload processing

Pasted/uploaded PNG, JPEG and WebP images are resized to at most 1920 pixels on the longest edge and encoded as compressed WebP before upload. Oversized PDFs up to 30 MB get a lossless object-stream compression attempt using pdf-lib; this does not guarantee reducing scanned images. Any final file over 10 MB is rejected. The bucket enforces the final size and MIME allowlist. Never upload videos. Attachments and pasted images work in documents and shared release contributions.

## Outlook announcements: test mode only

Keep the website at https://hoora-docs.vercel.app. A purchased domain and Resend API key are not required for the current Outlook integration. After publication choose Email announcement to preview the HTML template, Connect Outlook to grant delegated Mail.Send, then Send test to Rahul. Every backend send fixes the sole recipient to rahul@hoora.me and rejects client-supplied To/CC/BCC. Publishing does not send email. The sender is the connected Microsoft user and must match the authenticated member. Microsoft saves the message in Sent Items. No company-wide sending or employee directory synchronization is enabled.

Outlook tokens stay only in the current browser tab's session storage. They are not placed in env files, the database, or persistent local storage. Reconnect Outlook after expiry. A service-only send reservation prevents repeating the same test request; an interrupted send must be checked in Sent Items before starting another test. The subtle template footer identifies Hoora Docs as maintained by Rahul Tripathi; the actual sender and contribution authors are shown truthfully.

The Entra registration includes delegated Mail.Send. Rahul's individual delegated permission grant is configured; other senders may require tenant consent. The backend is fixed to test delivery. Enabling announcements to everyone later requires a separately approved recipient list or Outlook distribution group and a code/configuration change. The existing login permission cannot enumerate all employees. A company subdomain can be added to Vercel and a verified sending subdomain to Resend later.

## Additional verification

Run npm run test:releases for live multi-user authorization and snapshot checks. Run npm run test:browser for responsive login/release views, themes, template preview and browser image compression. Live checks create and remove temporary records. Browser tests require Chrome on Windows or a Playwright Chromium installation elsewhere; test:browser expects the clearly labelled demo release created by scripts/seed-demo.mjs. No test sends email automatically.
