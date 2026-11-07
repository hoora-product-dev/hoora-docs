# Hoora Docs delivery architecture

The current implementation and operational steps are documented in [README](../README.md). Keep the lightweight Vercel + Supabase deployment and preserve the existing project and employee accounts.

## Content structure

Application → independent release version → configured reusable sections → individually attributed contributions. The public feed orders published versions by publication date across applications. Selecting an application reveals its own section filters and version archive. Release pages are native pages with an outline, not dialogs.

Ordinary documents belong to a collection and can optionally belong to a team and folder. Team membership controls collaboration; the document’s explicit sharing mode controls readers. These metadata dimensions do not force everyone into one fixed folder tree.

## Roles

Administrator: full company control, including email testing, archive/restore and deletion.
Manager: owns assigned teams, assigns team viewer/publisher access, manages team documents/sharing and sends in-app notices.
Publisher: contributes to company collections; team publisher membership grants contribution to that team without a global role promotion.
Viewer: reads permitted published knowledge, shares links and requests company publisher access.

Backend RLS, service APIs and preview-ticket checks enforce these permissions. Restricted documents also restrict draft access for unrelated publishers. Owners, the team manager and administrators retain access. Removing team membership or sharing grants affects the next read, storage request and preview-ticket check.

## Data boundaries

Keep only the current draft and published content. Audit events record actions, not per-edit content copies. Old slugs redirect to the existing published asset. Published release versions remain separate content records.

Browser notifications are opt-in and separate from publication. Managers can announce their team documents; administrators can announce all permitted published documents. A database lock enforces one notice per document per three hours. Outlook remains test-only to Rahul and administrator-only.

Do not mutate InterviewGPT. The migration command explicitly verifies Hoora’s Supabase project ID before applying SQL. Database credentials and push private keys stay outside the repository and browser bundles.
