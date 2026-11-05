# Hoora Product Knowledge Hub: lightweight delivery plan

## Platform choice

Keep the existing Vercel static build and serverless API routes with Supabase Auth, Postgres, RLS and Storage. Use GitBook Open as a reading-design reference. Its repository renders content from GitBook's API and does not supply the authoring backend. Copying that monorepo would add Next.js/Bun/Turbo and a content API adapter without replacing Hoora's workflow needs. Tiptap's open-source editor core is now bundled locally for visual authoring; Markdown remains the stored document format.

## Navigation

The public entry opens **All product updates**, ordered by actual publication date. A reader can select an application to see its continuous release history, open a version as a full page, and navigate sections from the page outline. SOPs, documentation and future collections live in the same library with visibility controlled by the database. A single header and search control lead to the relevant content; admin tasks stay inside the workspace.

## Content model

- Application: independent release versions and public/internal visibility.
- Configured application section: reusable across versions; a section may be reused in several applications. Admins can change its order or archive it. Archiving prevents new contributions and keeps published content readable.
- Release: one application, one version, stable slug, publication date and publisher.
- Contribution: one release, one configured section, one real author from the authenticated account, its own heading, Markdown body and update date. Several authors may contribute to the same section and version.
- SOP/documentation: collection, title, stable slug, Markdown or isolated HTML artifact, optional folder/metadata and explicit visibility. A future sharing grant table must control access to selected people or groups at the database level.

Only the current draft and the published page are needed. Do not store a revision per edit. Keep published release versions as permanent records and record the latest editor and publisher.

## Roles and access

Target roles: administrator (all scopes, users, structure and email), manager (assigned scopes, sharing and in-app notices), publisher (contributes and publishes in assigned scopes), viewer (reads permitted material). Microsoft Entra tenant and company-domain validation remain server-side. Existing three-role permissions must be migrated together with database policies and API checks before exposing manager controls. Hiding a button is not an authorization rule.

Public releases need no login. Internal SOPs and documents need a valid Hoora session. Restricted documents need a person/team grant checked by RLS, including when opened from a direct link. Public and private assets must not share unsigned raw storage URLs.

## Keep / omit

Keep: Markdown formatting and preview, sanitized rendering, standalone HTML in an opaque sandbox, PDF/document uploads, WebP image conversion, full release pages, search, folder/collection metadata, SSO, roles, signed storage access, mobile layout and light/dark mode.

Omit from this Vercel/Supabase build: GitBook's API proxy and rendering monorepo, complex OpenAPI/diagram processors, AI search, real-time coediting, per-keystroke history, video uploads, and automated company-wide email sends. Any optional expensive renderer should be added only when a real Hoora document needs it and has an explicit resource budget.

## Notification boundary

Publishing is separate from sending. Only an administrator can send Outlook email; test recipients remain locked to `rahul@hoora.me`. Manager/admin in-app notices should use a per-document cooldown and record the sender. The app must not turn on company-wide sending until the recipient and approval workflow are explicitly ready.

## Migration order

1. Preserve the live schema and exported data; identify sample records before removing any.
2. Apply the additive project-section and publisher migration, then expose project-scoped configuration and contribution selection.
3. Add scoped role and sharing-grant migrations with RLS tests for direct links and storage.
4. Verify existing public URLs, SSO, author attribution, exports, private access and rollback path.
5. Remove demo data after verified migration; avoid a blanket database reset.
6. Deploy the tested build through the existing GitHub→Vercel integration and verify the live URL.

The current project has only the Supabase API URL, browser key and service key locally. The database migration needs the correct project's database-management access; the Supabase MCP connection in this environment points to a different project and must not be used for this migration.
