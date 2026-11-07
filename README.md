<div align="center">
  <img src="public/app-icon-512.png" alt="Hoora Docs" width="104" />
  <h1>Hoora Docs</h1>
  <p>Release notes, SOPs and team documentation for Hoora, in one place.</p>

  <p>
    <img src="https://img.shields.io/badge/version-1.0.0-171717?style=flat-square" alt="Version 1.0.0" />
    <img src="https://img.shields.io/badge/JavaScript-ES_modules-F7DF1E?style=flat-square&logo=javascript&logoColor=black" alt="JavaScript ES modules" />
    <img src="https://img.shields.io/badge/Supabase-Postgres_%C2%B7_Auth_%C2%B7_Storage-3ECF8E?style=flat-square&logo=supabase&logoColor=white" alt="Supabase" />
    <img src="https://img.shields.io/badge/Hosting-Vercel-000000?style=flat-square&logo=vercel&logoColor=white" alt="Vercel" />
    <img src="https://img.shields.io/badge/Sign--in-Microsoft-5E5E5E?style=flat-square&logo=microsoft&logoColor=white" alt="Microsoft sign-in" />
    <img src="https://img.shields.io/badge/PWA-installable-5A0FC8?style=flat-square&logo=pwa&logoColor=white" alt="Installable web app" />
    <img src="https://img.shields.io/badge/Node-22+-339933?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node 22 or newer" />
  </p>

  <p>
    <a href="https://hoora-docs.vercel.app"><strong>Open Hoora Docs</strong></a>
    ·
    <a href="https://hoora-docs.vercel.app/install">Install the app</a>
  </p>
</div>

## Overview

Hoora Docs is the internal knowledge hub for Hoora teams. Each platform publishes versioned release notes, written by the teams that own each vertical. Teams keep their SOPs and documentation in one library and share them with exactly the people who need them. Everything requires a Hoora sign-in. Nothing is public.

## What is implemented

| Area               | Implementation                                                                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Release notes      | Per platform and version, with one complete Markdown note per vertical (Auto Care, Car Services & Repair, Products, Value Added Services), each owned and published by its team |
| Upcoming releases  | Live Jira saved-filter view with Vertical and Product Owner filters                                                                                                             |
| Library            | SOPs and documentation by collection and team, with Markdown, PDFs, HTML artifacts and drawings                                                                                 |
| Sharing            | Organization, team only, specific teams or specific people, enforced by database policies                                                                                       |
| People & access    | Whiteboard canvas to place people into teams, with Viewer, Editor, Publisher and Manager roles                                                                                  |
| Search & assistant | Permission-aware search and Hoora Assist with cited answers                                                                                                                     |
| App                | Installable web app with notifications, a phone tab bar and a responsive layout                                                                                                 |

## Architecture

```text
Browser (ES modules, no framework)
        ↓
Vercel static hosting  ·  Vercel serverless API (/api)
        ↓                          ↓
Supabase Auth  ←→  Postgres with row-level security  ←→  Supabase Storage
                          ↑
            Jira (read-only)  ·  Microsoft Entra ID
```

The database is the source of truth for access. Every read and write passes row-level security, and private files are served only to people who can open the document they belong to.

## Local setup

### Requirements

- Node.js 22 or newer
- Access to the Hoora Supabase project and its environment values

### Configure and run

1. Clone the repository:

   ```bash
   git clone https://github.com/hoora-product-dev/hoora-docs.git
   cd hoora-docs
   ```

2. Install dependencies and create your environment file:

   ```bash
   npm ci
   cp .env.example .env
   ```

3. Fill in `.env` with the project values, then start the app at `http://localhost:3000`:

   ```bash
   npm run dev
   ```

Environment values and the database schema are managed privately and are never committed.

> [!NOTE]
> Only the Supabase URL and public browser key reach the browser. Service keys, Microsoft, Jira and AI Gateway credentials stay on the server.

### Scripts

| Command          | Purpose                                        |
| ---------------- | ---------------------------------------------- |
| `npm run dev`    | Local server with live API routes              |
| `npm run build`  | Production build into `dist/`                  |
| `npm test`       | Unit and security tests                        |
| `npm run check`  | Syntax check for every JavaScript and CSS file |
| `npm run knip`   | Unused files, exports and dependencies         |
| `npm run format` | Prettier formatting                            |

## Repository layout

```text
hoora-docs/
├── api/          # Vercel serverless endpoints (auth, content, Jira, assistant, cleanup)
├── server/       # Shared server helpers (Supabase, Jira, email, links)
├── public/       # The web app: routing, pages, editor, PWA and assets
├── src/          # Bundled modules (rich editor, drawing, PDF viewer) and styles
├── scripts/      # Build, development and database maintenance
└── tests/        # Unit, security and browser tests
```

## Deployment

Vercel builds `main` with `npm run build` and serves `dist/`. A daily job (`/api/cleanup`) empties the 30-day recycle bin and trims old activity, which keeps the project within the Supabase free plan.

---

<p align="center">
  Developed and maintained by <a href="https://github.com/rahultripathi17">Rahul Tripathi</a>
  · <a href="https://rahul-tripathi.web.app">Portfolio</a>
  · <a href="https://www.linkedin.com/in/rahultripathi17/">LinkedIn</a>
  <br />
  Licensed under <a href="LICENSE">MIT</a>
</p>
