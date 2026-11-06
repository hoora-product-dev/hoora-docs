import { randomUUID } from 'node:crypto';
import { loadEnvFile } from 'node:process';
import pg from 'pg';
import { serverClient } from '../server/supabase.js';

loadEnvFile();
const call = serverClient();
const api = async (table, query = '', method = 'GET', body) => call(`/rest/v1/${table}${query}`, {
  method, headers: { Prefer: 'return=representation' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const one = async (table, column, value) => (await api(table, `?${column}=eq.${encodeURIComponent(value)}&select=*`))[0];
const insert = async (table, row) => (await api(table, '', 'POST', row))[0];
if (!process.env.SUPABASE_DB_PASSWORD) throw new Error('SUPABASE_DB_PASSWORD is required to seed sample contributors.');
const client = new pg.Client({
  host: 'aws-0-ap-south-1.pooler.supabase.com', port: 5432, database: 'postgres',
  user: 'postgres.jrjkxddjwcphdmjeqyfq', password: process.env.SUPABASE_DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
});
await client.connect();
const sections = Object.fromEntries((await api('docs_verticals', '?select=*')).map(row => [row.name, row]));

const apps = [
  ['Customer App', 'phone', 'blue', ['Auto Care', 'Garage Services', 'Products & Accessories', 'VSA']],
  ['Admin Panel', 'settings', 'slate', ['Operations', 'Customer Experience', 'Product & Engineering']],
  ['Hoora on Web', 'web', 'green', ['Auto Care', 'Products & Accessories']],
  ['Partner App (Sample)', 'tool', 'orange', ['Garage Services', 'VSA']],
];
const examples = [
  ['Customer App', '5.11.0', '2026-11-05', [
    ['Auto Care', 'Booking flow clarity', 'Customers can compare available slots before checkout and see service inclusions on the same page.', 'Aditi'],
    ['Garage Services', 'Service progress details', 'The status screen explains inspection, work in progress, and handover in plain language.', 'Kabir'],
    ['Products & Accessories', 'Accessory compatibility', 'Product pages show compatibility guidance next to the vehicle selection.', 'Palak'],
    ['VSA', 'Advisor follow-up queue', 'Advisors can see the next action and due time for every open request.', 'Neha'],
  ]],
  ['Admin Panel', '3.8.2', '2026-11-04', [
    ['Operations', 'Clearer booking exceptions', 'Exception cases show the reason, owner, and next action in one view.', 'Rohan'],
    ['Customer Experience', 'Customer case handoff', 'Support and operations can follow a shared handoff checklist.', 'Mira'],
    ['Product & Engineering', 'Activity filtering', 'The activity log can be filtered by actor and date.', 'Ishaan'],
  ]],
  ['Hoora on Web', '2.6.0', '2026-10-29', [
    ['Auto Care', 'Service comparison', 'Visitors can compare service packages and read what each includes.', 'Tara'],
    ['Products & Accessories', 'Search improvements', 'Search results show category and vehicle compatibility before opening a product.', 'Dev'],
  ]],
  ['Customer App', '5.10.0', '2026-10-21', [
    ['Auto Care', 'Appointment reminder', 'Customers receive a clearer appointment reminder and preparation checklist.', 'Aditi'],
    ['Garage Services', 'Workshop handover', 'The handover summary lists completed work and next steps.', 'Kabir'],
  ]],
  ['Admin Panel', '3.8.1', '2026-10-14', [
    ['Operations', 'Daily queue summary', 'The queue groups open issues by urgency and assigned team.', 'Rohan'],
  ]],
  ['Partner App (Sample)', '1.4.0', '2026-09-30', [
    ['Garage Services', 'Job acceptance', 'Partners can review the job scope before accepting a service request.', 'Kabir'],
    ['VSA', 'Advisor escalation', 'An escalation includes customer context and the requested response time.', 'Neha'],
  ]],
];
const docs = [
  ['sample-challan-resolution-sop', 'sop', 'Sample: Challan resolution SOP', 'Operations', '2026-10-31', '# Before you start\n\nCollect the challan reference, vehicle registration, and customer contact details.\n\n# Check the source\n\n1. Verify the challan reference in the source system.\n2. Compare vehicle details with the customer report.\n3. Record the result in the case notes.\n\n# Escalate when needed\n\nEscalate disputed or time-sensitive cases to the operations owner. This is sample content only.'],
  ['sample-release-contribution-guide', 'documentation', 'Sample: How to contribute to a release', 'Product & Engineering', '2026-11-02', '# Find the right application\n\nOpen Release notes and choose the application you worked on. Each application has its own version history.\n\n# Add your contribution\n\nChoose the section that matches your work, write a short heading, and explain the customer-visible change. Your name is recorded with your note.\n\n# Preview and publish\n\nPreview the assembled page before publishing. Only notes marked ready appear in the published release. This is sample content only.'],
];

const projectByName = {};
for (const [name, icon, color, sectionNames] of apps) {
  let project = await one('docs_projects', 'name', name);
  if (!project) project = await insert('docs_projects', { name, icon, color, visibility: 'public', description: name.includes('Sample') ? 'Sample application for release browsing.' : `Release history for ${name}.` });
  projectByName[name] = project;
  const existing = await api('docs_project_sections', `?project_id=eq.${project.id}&select=vertical_id`);
  for (const [index, sectionName] of sectionNames.entries()) {
    const section = sections[sectionName];
    if (!section) throw new Error(`Missing section: ${sectionName}`);
    if (!existing.some(row => row.vertical_id === section.id)) await insert('docs_project_sections', { project_id: project.id, vertical_id: section.id, sort_order: index, active: true });
  }
}

let created = 0;
for (const [appName, version, date, notes] of examples) {
  const project = projectByName[appName];
  const slug = `sample-${appName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${version.replace(/[^a-z0-9]+/gi, '-')}`;
  const published = await one('docs_published', 'slug', slug);
  if (published) continue;
  let page = await one('docs_pages', 'slug', slug);
  const conflict = await api('docs_releases', `?project_id=eq.${project.id}&version=eq.${encodeURIComponent(version)}&select=id`);
  if (conflict.length && (!page || conflict[0].id !== page.id)) continue;
  const id = page?.id || randomUUID(), timestamp = `${date}T10:00:00+05:30`;
  const title = `${appName} · ${version}`;
  const summary = 'Sample release for exploring the Hoora Docs workflow. This is not an actual product update.';
  const body = notes.map(([sectionName, heading, content, author]) => `## ${sectionName}\n\n### ${heading}\n\n${content}\n\nAdded by ${author} (sample)`).join('\n\n');
  if (!page) page = await insert('docs_pages', { id, slug, title, kind: 'release', summary, version, body, tags: ['sample'], visibility: 'public', format: 'markdown', created_at: timestamp });
  if (!conflict.length) await insert('docs_releases', { id, project_id: project.id, version });
  const existingEntries = await api('docs_entries', `?release_id=eq.${id}&select=title`);
  const missing = notes.filter(([, heading]) => !existingEntries.some(row => row.title === heading));
  if (missing.length) {
    // The real author trigger must remain in force for normal users. This transaction
    // blocks concurrent writes while inserting clearly marked fictional sample authors.
    await client.query('begin');
    try {
      await client.query('alter table public.docs_entries disable trigger docs_entry_stamp');
      for (const [sectionName, heading, content, author] of missing) {
        const by = `${author} (sample)`;
        await client.query('insert into public.docs_entries(release_id,vertical_id,title,body,author_name,updated_name,submitted,created_at,updated_at) values($1,$2,$3,$4,$5,$5,true,$6,$6)', [id, sections[sectionName].id, heading, content, by, timestamp]);
      }
      await client.query('alter table public.docs_entries enable trigger docs_entry_stamp');
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    }
  }
  const storedEntries = await api('docs_entries', `?release_id=eq.${id}&select=*`);
  const entries = storedEntries.map(entry => {
    const section = Object.values(sections).find(item => item.id === entry.vertical_id);
    return { id: entry.id, vertical_id: section.id, vertical: section.name, vertical_icon: section.icon, vertical_color: section.color, title: entry.title, body: entry.body, author: entry.author_name, edited_by: entry.updated_name, updated_at: timestamp };
  });
  page = await one('docs_pages', 'id', id);
  await insert('docs_published', { id, slug, title, kind: 'release', summary, version, body, tags: ['sample'], revision: page.revision, visibility: 'public', project_id: project.id, format: 'markdown', published_at: timestamp, release_snapshot: { project: appName, project_icon: project.icon, project_color: project.color, version, sample: true, entries } });
  created++;
}
for (const [slug, kind, title, sectionName, date, body] of docs) {
  if (await one('docs_published', 'slug', slug)) continue;
  let page = await one('docs_pages', 'slug', slug);
  const id = page?.id || randomUUID(), timestamp = `${date}T10:00:00+05:30`;
  const row = { id, slug, title, kind, summary: 'Example internal document for exploring Hoora Docs. Not an approved company policy.', body, version: '', tags: ['sample'], vertical_id: sections[sectionName].id, visibility: 'private', format: 'markdown' };
  if (!page) page = await insert('docs_pages', { ...row, created_at: timestamp });
  await insert('docs_published', { ...row, revision: page.revision, published_at: timestamp });
  created++;
}
console.log(`Sample content ready: ${created} new pages. Existing content was preserved.`);
await client.end();
