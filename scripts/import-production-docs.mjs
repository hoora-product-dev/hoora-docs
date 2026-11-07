/*
 * Replace seeded/demo content with the production release notes that are
 * available from the approved Hoora GitBook sources. Existing non-demo
 * employee accounts are preserved; demo auth accounts and content are removed.
 *
 * Run with: node scripts/import-production-docs.mjs --apply
 */
import { loadEnvFile } from 'node:process';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { databaseOptions } from './database-options.mjs';

loadEnvFile();
const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey)
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');

const apply = process.argv.includes('--apply');
const sources = [
  {
    platform: 'Hoora Web',
    projectSlug: 'hoora-web',
    url: 'https://hoora-notes.gitbook.io/hoora-on-web/llms.txt',
  },
  {
    platform: 'Customer App',
    projectSlug: 'customer-app',
    url: 'https://hoora-notes.gitbook.io/customer-app-releases/llms.txt',
  },
];

const api = async (path, options = {}) => {
  const response = await fetch(url + path, {
    ...options,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(data?.msg || data?.message || `Supabase request failed (${response.status}).`);
  return data;
};

const slug = (value) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 70);

const versionFrom = (value) => {
  const match = value.match(/v?([0-9]+(?:\.[0-9]+){1,3})/i);
  return match?.[1] || '0.0.0';
};

const dateFrom = (value) => {
  const match = value.match(/(?:Released|·)\s+([0-9]{1,2}\s+[A-Za-z]+\s+[0-9]{4})/i);
  const date = match ? new Date(match[1]) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
};

const ticketKeys = (value) => [...new Set(value.match(/\b[A-Z][A-Z0-9]+-\d+\b/g) || [])];

const verticalFor = (value) => {
  if (/product|accessor|catalog|fitment|cart|checkout|order/i.test(value)) return 'Products';
  if (/repair|garage|service|car wash|inspection|workshop|booking/i.test(value))
    return 'Car Repair & Services';
  if (/advisor|coin|point|subscription|insurance|notification|value[- ]added/i.test(value))
    return 'Value-added Services';
  return 'Auto Care';
};

const parsePage = (markdown, platform, sourceUrl) => {
  const content = markdown.replace(/^>.*(?:\r?\n|$)+/gm, '').trim();
  const title = content.match(/^#\s+(.+)$/m)?.[1]?.trim() || 'Release notes';
  const version = versionFrom(title + ' ' + content.slice(0, 500));
  const publishedAt = dateFrom(title + '\n' + content.slice(0, 800));
  const body = content.replace(/^#\s+.+\r?\n/, '').trim();
  const summary = `${platform} release notes for v${version}, imported from the approved source.`;
  const sections = [];
  const sectionPattern = /^####\s+(.+)\r?\n([\s\S]*?)(?=^####\s+|^###\s+|^##\s+|$)/gim;
  for (const match of body.matchAll(sectionPattern)) {
    const heading = match[1].trim();
    const sectionBody = match[2].trim();
    if (sectionBody) sections.push({ heading, body: sectionBody });
  }
  if (!sections.length) sections.push({ heading: `${platform} v${version}`, body });
  const entries = sections.map((section) => {
    const text = `${section.heading}\n${section.body}`;
    return {
      title: section.heading.replace(/^\d+\.\s*/, '').slice(0, 200),
      body: `### ${section.heading}\n\n${section.body}`.slice(0, 100000),
      tickets: ticketKeys(text).join(', '),
      vertical: verticalFor(text),
    };
  });
  return {
    platform,
    projectSlug: slug(platform),
    version,
    title: `${platform} · v${version}`,
    slug: `${slug(platform)}-v${slug(version)}`,
    summary,
    body: body.slice(0, 500000),
    publishedAt,
    sourceUrl,
    entries,
  };
};

const loadSources = async () => {
  const pages = [];
  for (const source of sources) {
    const index = await (await fetch(source.url)).text();
    const links = [...index.matchAll(/\[[^\]]+\]\((https?:[^)]+\.md)\)/g)].map((m) => m[1]);
    for (const pageUrl of links) {
      const markdown = await (await fetch(pageUrl)).text();
      pages.push(parsePage(markdown, source.platform, pageUrl));
    }
  }
  return pages;
};

const pages = await loadSources();
if (!pages.length) throw new Error('No approved GitBook release notes were found.');
console.log(`Prepared ${pages.length} imported release notes from GitBook.`);
console.log('Drive source was not imported because it currently requires Google sign-in.');
if (!apply) {
  console.log('Dry run only. Re-run with --apply to replace seeded content.');
  process.exit(0);
}

const client = new pg.Client(databaseOptions());
await client.connect();
const q = (text, values = []) => client.query(text, values);
const scalar = async (text, values = []) => (await q(text, values)).rows[0];
try {
  const rahul = await scalar(
    "select id,name,email from public.docs_members where lower(email)='rahul@hoora.me' and active",
  );
  if (!rahul) throw new Error('rahul@hoora.me must exist before importing production content.');

  await q('begin');
  await q('alter table public.docs_pages disable trigger user');
  await q('alter table public.docs_entries disable trigger user');
  await q(`delete from public.docs_team_permissions;
    delete from public.docs_team_members;
    delete from public.docs_relationships;
    delete from public.docs_page_access;
    delete from public.docs_notice_reads;
    delete from public.docs_notices;
    delete from public.docs_requests;
    delete from public.docs_push_subscriptions where user_id in (select id from public.docs_members where email like 'hoora-demo-%@hoora.me');
    delete from public.docs_ai_chunks;
    delete from public.docs_published_index;
    delete from public.docs_published;
    delete from public.docs_audit_log;
    delete from public.docs_releases;
    delete from public.docs_entries;
    delete from public.docs_slug_aliases;
    delete from public.docs_mail_tests;
    delete from public.docs_pages;
    delete from public.docs_project_sections;
    delete from public.docs_upcoming_releases;
    delete from public.docs_projects;
    delete from public.docs_folders;
    delete from public.docs_teams;
    delete from public.docs_storage_cleanup;
    delete from public.docs_verticals;
    delete from public.docs_members where email like 'hoora-demo-%@hoora.me';`);

  const verticals = {};
  for (const [name, description, icon, color] of [
    ['Auto Care', 'Vehicle care and customer journeys', 'car', 'blue'],
    ['Car Repair & Services', 'Garage, repair, and service journeys', 'tool', 'orange'],
    ['Products', 'Products, accessories, and fitment', 'bag', 'violet'],
    ['Value-added Services', 'Advisor and value-added service workflows', 'users', 'green'],
  ]) {
    verticals[name] = await scalar(
      'insert into public.docs_verticals(name,description,icon,color) values($1,$2,$3,$4) returning *',
      [name, description, icon, color],
    );
  }

  const teams = {};
  for (const [name, teamSlug] of [
    ['Product Team', 'product-team'],
    ['Operations Team', 'operations-team'],
    ['Customer Experience Team', 'customer-experience-team'],
    ['Technology Team', 'technology-team'],
  ]) {
    teams[teamSlug] = await scalar(
      'insert into public.docs_teams(name,slug,manager_id) values($1,$2,$3) returning *',
      [name, teamSlug, rahul.id],
    );
    await q(
      "insert into public.docs_team_members(team_id,email,role,added_by) values($1,$2,'manager',$3)",
      [teams[teamSlug].id, rahul.email, rahul.id],
    );
  }

  const folders = {};
  for (const [name, folderSlug, teamSlug] of [
    ['Release notes', 'release-notes', 'product-team'],
    ['Upcoming releases', 'upcoming-releases', 'product-team'],
    ['SOPs', 'sops', 'operations-team'],
    ['Documentation', 'documentation', 'technology-team'],
  ]) {
    folders[folderSlug] = await scalar(
      `insert into public.docs_folders(name,slug,visibility,icon,color,team_id)
       values($1,$2,'private','folder','slate',$3) returning *`,
      [name, folderSlug, teams[teamSlug].id],
    );
  }

  const projects = {};
  for (const [name, projectSlug, icon, color, teamSlug] of [
    ['Customer App', 'customer-app', 'phone', 'blue', 'product-team'],
    ['Panels', 'panels', 'settings', 'slate', 'operations-team'],
    ['Partner App', 'partner-app', 'tool', 'slate', 'customer-experience-team'],
    ['Hoora Web', 'hoora-web', 'web', 'slate', 'technology-team'],
  ]) {
    projects[projectSlug] = await scalar(
      `insert into public.docs_projects(name,slug,description,visibility,icon,color)
       values($1,$2,$3,'private',$4,$5) returning *`,
      [name, projectSlug, `${name} production release history.`, icon, color],
    );
    for (const [index, vertical] of Object.values(verticals).entries())
      await q(
        'insert into public.docs_project_sections(project_id,vertical_id,sort_order,active) values($1,$2,$3,true)',
        [projects[projectSlug].id, vertical.id, index],
      );
  }

  for (const page of pages) {
    const project = projects[page.projectSlug];
    const team =
      page.projectSlug === 'customer-app' ? teams['product-team'] : teams['technology-team'];
    const id = randomUUID();
    const entries = page.entries.map((entry) => ({
      title: entry.title,
      section: entry.vertical,
      body: entry.body,
      tickets: entry.tickets,
      author: rahul.name,
    }));
    const dbPage = await scalar(
      `insert into public.docs_pages(id,title,slug,kind,body,summary,version,tags,created_by,updated_by,visibility,folder_id,team_id,source_type,created_at,updated_at)
       values($1,$2,$3,'release',$4,$5,$6,array['imported','release'],$7,$7,'private',$8,$9,'MARKDOWN',$10,$10) returning *`,
      [
        id,
        page.title,
        page.slug,
        page.body,
        page.summary,
        page.version,
        rahul.id,
        folders['release-notes'].id,
        team.id,
        page.publishedAt,
      ],
    );
    await q('insert into public.docs_releases(id,project_id,version) values($1,$2,$3)', [
      id,
      project.id,
      page.version,
    ]);
    for (const entry of page.entries) {
      await q(
        `insert into public.docs_entries(release_id,vertical_id,title,body,tickets,submitted,author_id,author_name,updated_by,updated_name)
         values($1,$2,$3,$4,$5,true,$6,$7,$6,$7)`,
        [
          id,
          verticals[entry.vertical].id,
          entry.title,
          entry.body,
          entry.tickets,
          rahul.id,
          rahul.name,
        ],
      );
    }
    await q(
      `insert into public.docs_published(id,title,slug,kind,body,summary,version,tags,revision,format,release_snapshot,visibility,folder_id,project_id,published_by,published_by_name,team_id,owner_id,owner_name,source_type,published_at)
       values($1,$2,$3,'release',$4,$5,$6,array['imported','release'],1,'markdown',$7,'private',$8,$9,$10,$11,$12,$10,$11,'MARKDOWN',$13)`,
      [
        dbPage.id,
        dbPage.title,
        dbPage.slug,
        dbPage.body,
        dbPage.summary,
        dbPage.version,
        JSON.stringify({
          project: page.platform,
          project_slug: page.projectSlug,
          version: page.version,
          release_date: page.publishedAt,
          source_url: page.sourceUrl,
          entries,
        }),
        folders['release-notes'].id,
        project.id,
        rahul.id,
        rahul.name,
        team.id,
        page.publishedAt,
      ],
    );
  }

  for (const team of Object.values(teams))
    for (const collection of ['sop', 'documentation'])
      await q(
        "insert into public.docs_team_permissions(team_id,scope_type,collection_key,capability,granted_by) values($1,'collection',$2,'contribute',$3)",
        [team.id, collection, rahul.id],
      );
  for (const teamSlug of ['product-team', 'technology-team'])
    for (const project of Object.values(projects))
      await q(
        "insert into public.docs_team_permissions(team_id,scope_type,project_id,capability,granted_by) values($1,'project',$2,'publish',$3)",
        [teams[teamSlug].id, project.id, rahul.id],
      );

  await q('alter table public.docs_pages enable trigger user');
  await q('alter table public.docs_entries enable trigger user');
  await q('commit');
} catch (error) {
  await q('rollback');
  throw error;
} finally {
  await client.end();
}

const existing = await api('/auth/v1/admin/users?per_page=100');
for (const user of existing.users || [])
  if (user.email?.toLowerCase().startsWith('hoora-demo-'))
    await api(`/auth/v1/admin/users/${user.id}`, { method: 'DELETE' });

console.log(`Imported ${pages.length} production release notes and removed seeded demo content.`);
