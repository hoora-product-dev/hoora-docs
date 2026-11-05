# GitBook Open evaluation for Hoora

Checked 5 November 2026 against `GitbookIO/gitbook` main, cloned read-only into `research/gitbook-upstream`.

## Decision

Use its published-document reading patterns as a design reference. Continue with Hoora's existing application and Supabase foundation. Build the writing experience with Tiptap's open-source editor packages. Do not copy GitBook source into the Hoora app.

## Evidence

GitBook's own README calls this repository the open-source code used to **render GitBook's published content**. Its development server proxies existing published GitBook URLs. The reader imports `@gitbook/api` and fetches GitBook space, site and revision objects. The hosted content editor, organization management, and storage backend needed for Hoora are not in this repository. The root is a Bun/Turbo monorepo with a Next.js app and multiple rendering packages; adapting it to Supabase would require replacing the data and auth layer, not a few UI edits.

The repository is GPL-3.0. Its README instructs operators who distribute the code to keep the source public, and directs private-repository use to a commercial license. Hoora's current GitHub repository is public, but a wholesale fork would still introduce GPL obligations and more maintenance than the reader patterns justify. This is an engineering and licensing consideration, not a legal opinion.

## What carries into Hoora

- A permanent page for each published release, SOP, and document.
- Navigation by application, version and section, plus an on-page outline.
- A calm content-first layout with reliable formatting and responsive reading.
- A version archive for each application and a company-wide chronological update feed.

## Migration boundary

Retain the existing Supabase project and content until every replacement route, permission rule, storage path, and permalink is working and checked. Preserve stable document identifiers and published slugs. Move demo/test content only after it can be distinguished from real content. No destructive database reset is part of this decision.

## Sources

- https://github.com/GitbookIO/gitbook
- https://github.com/GitbookIO/gitbook/blob/main/README.md
- https://github.com/GitbookIO/gitbook/blob/main/LICENSE
- https://github.com/GitbookIO/gitbook/blob/main/packages/gitbook/src/lib/data/api.ts
