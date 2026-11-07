import { databaseOptions } from './database-options.mjs';
import { randomUUID } from 'node:crypto';
import { loadEnvFile } from 'node:process';
import pg from 'pg';
import { serverClient } from '../server/supabase.js';

loadEnvFile();
const call = serverClient();
const api = async (table, query = '', method = 'GET', body) =>
  call(`/rest/v1/${table}${query}`, {
    method,
    headers: { Prefer: 'return=representation' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const one = async (table, column, value) =>
  (await api(table, `?${column}=eq.${encodeURIComponent(value)}&select=*`))[0];
const insert = async (table, row) => (await api(table, '', 'POST', row))[0];
if (!process.env.SUPABASE_DB_PASSWORD)
  throw new Error('SUPABASE_DB_PASSWORD is required to seed sample contributors.');
const client = new pg.Client(databaseOptions());
await client.connect();
const sections = Object.fromEntries(
  (await api('docs_verticals', '?select=*')).map((row) => [row.name, row]),
);

const apps = [
  [
    'Customer App',
    'phone',
    'blue',
    ['Auto Care', 'Garage Services', 'Products & Accessories', 'VSA'],
  ],
  ['Panels', 'settings', 'slate', ['Operations', 'Customer Experience', 'Product & Engineering']],
  [
    'Hoora on Web',
    'web',
    'slate',
    ['Auto Care', 'Products & Accessories', 'Product & Engineering'],
  ],
  ['Partner App', 'tool', 'slate', ['Garage Services', 'VSA', 'Operations']],
];
const examples = [
  [
    'Customer App',
    '5.15.0',
    '2026-11-06',
    [
      [
        'Auto Care',
        'Booking comparison and confirmation',
        'Customers can compare service slots, see what each package includes, and review the vehicle and address before confirming. The booking summary keeps price, duration, and next steps together.',
        'Aanya Verma (Demo)',
      ],
      [
        'Garage Services',
        'Service progress and handover',
        'The service timeline now separates inspection, repair, and handover. Each stage shows its latest update and the action expected from the customer.',
        'Kabir Mehta (Demo)',
      ],
      [
        'Products & Accessories',
        'Vehicle fitment guidance',
        'Accessory pages show vehicle compatibility before checkout and explain when a selected product does not fit the chosen model.',
        'Mira Shah (Demo)',
      ],
      [
        'VSA',
        'Advisor follow-up queue',
        'Advisors can see the customer request, next action, and response due time together. Completed follow-ups remain visible in the request history.',
        'Dev Nair (Demo)',
      ],
    ],
  ],
  [
    'Panels',
    '3.9.0',
    '2026-11-05',
    [
      [
        'Operations',
        'Booking exception triage',
        'The operations queue groups booking exceptions by urgency and shows the current owner, reason, and recommended next step.',
        'Rohan Das (Demo)',
      ],
      [
        'Customer Experience',
        'Shared customer case view',
        'Support and operations can review the same case timeline, reducing repeated questions during a handoff.',
        'Ira Sen (Demo)',
      ],
      [
        'Product & Engineering',
        'Activity filters',
        'Panel activity can be filtered by date, actor, and action. The selected filters remain in the URL for sharing a focused view.',
        'Neil Rao (Demo)',
      ],
    ],
  ],
  [
    'Hoora on Web',
    '2.8.0',
    '2026-11-06',
    [
      [
        'Auto Care',
        'Service discovery pages',
        'Visitors can compare service packages by inclusions, duration, and availability before moving into booking.',
        'Tara Iyer (Demo)',
      ],
      [
        'Products & Accessories',
        'Catalog search and fitment',
        'Search results show category and vehicle compatibility so visitors can narrow the catalog without opening each product.',
        'Aarav Kulkarni (Demo)',
      ],
      [
        'Product & Engineering',
        'Accessible navigation',
        'Primary navigation and product filters support keyboard focus and maintain clear labels at smaller screen sizes.',
        'Nisha Roy (Demo)',
      ],
    ],
  ],
  [
    'Partner App',
    '1.6.0',
    '2026-11-05',
    [
      [
        'Garage Services',
        'Job scope before acceptance',
        'Partners can review the requested work, vehicle details, and customer-selected slot before accepting a job.',
        'Karan Joshi (Demo)',
      ],
      [
        'VSA',
        'Advisor escalation context',
        'Escalations include the customer request, work already completed, and response deadline so the next team can act without rebuilding context.',
        'Meera Pillai (Demo)',
      ],
      [
        'Operations',
        'Daily job closeout',
        'The closeout view highlights incomplete notes and pending customer updates before a job is marked complete.',
        'Samir Rao (Demo)',
      ],
    ],
  ],
  [
    'Customer App',
    '5.14.0',
    '2026-11-03',
    [
      [
        'Auto Care',
        'Reschedule without restarting',
        'Customers can choose another available slot while keeping the selected service package and vehicle details.',
        'Aanya Verma (Demo)',
      ],
      [
        'Garage Services',
        'Inspection update summary',
        'Inspection notes are organized by finding and recommended action, making the service update easier to scan.',
        'Kabir Mehta (Demo)',
      ],
      [
        'Products & Accessories',
        'Saved product comparison',
        'Customers can compare selected accessories on one page and return to the same comparison later.',
        'Mira Shah (Demo)',
      ],
      [
        'VSA',
        'Request status reminders',
        'The app sends a reminder when an advisor needs more information and links directly to the open request.',
        'Dev Nair (Demo)',
      ],
    ],
  ],
  [
    'Panels',
    '3.8.4',
    '2026-11-02',
    [
      [
        'Operations',
        'Service queue ownership',
        'Unassigned service cases are visible in a dedicated queue, with clear ownership when an operator claims a case.',
        'Rohan Das (Demo)',
      ],
      [
        'Customer Experience',
        'Case handoff checklist',
        'The handoff checklist captures customer context, completed checks, and the next response expected.',
        'Ira Sen (Demo)',
      ],
      [
        'Product & Engineering',
        'Saved table filters',
        'Panel users can return to their recent status and date filters when reviewing recurring work.',
        'Neil Rao (Demo)',
      ],
    ],
  ],
  [
    'Hoora on Web',
    '2.7.0',
    '2026-11-03',
    [
      [
        'Auto Care',
        'Coverage before checkout',
        'Service availability is checked against the selected address before a visitor starts checkout.',
        'Tara Iyer (Demo)',
      ],
      [
        'Products & Accessories',
        'Product detail improvements',
        'Product details surface delivery information, key specifications, and related accessories in a consistent order.',
        'Aarav Kulkarni (Demo)',
      ],
      [
        'Product & Engineering',
        'Faster content navigation',
        'Long product pages include a compact contents menu and return the visitor to the last viewed section.',
        'Nisha Roy (Demo)',
      ],
    ],
  ],
  [
    'Partner App',
    '1.5.0',
    '2026-11-01',
    [
      [
        'Garage Services',
        'Availability calendar',
        'Partners can review upcoming service capacity by day and update available slots without leaving the job queue.',
        'Karan Joshi (Demo)',
      ],
      [
        'VSA',
        'Customer context on open requests',
        'Open requests show the vehicle, selected service, and recent customer messages before an advisor responds.',
        'Meera Pillai (Demo)',
      ],
      [
        'Operations',
        'Partner job filters',
        'The job list can be narrowed by status and due date to make daily follow-up easier.',
        'Samir Rao (Demo)',
      ],
    ],
  ],
  [
    'Customer App',
    '5.13.0',
    '2026-10-30',
    [
      [
        'Auto Care',
        'Package details at selection',
        'Service inclusions and estimated duration are visible while customers compare packages.',
        'Aanya Verma (Demo)',
      ],
      [
        'Garage Services',
        'Workshop status timeline',
        'Customers can see when a vehicle is received, inspected, and ready for handover.',
        'Kabir Mehta (Demo)',
      ],
      [
        'Products & Accessories',
        'Category and vehicle filters',
        'Catalog filters combine product category with vehicle fitment and can be cleared independently.',
        'Mira Shah (Demo)',
      ],
      [
        'VSA',
        'Advisor notes in one thread',
        'Customer-visible updates and advisor follow-ups appear in chronological order on the request.',
        'Dev Nair (Demo)',
      ],
    ],
  ],
  [
    'Panels',
    '3.8.3',
    '2026-10-28',
    [
      [
        'Operations',
        'Daily queue overview',
        'The operations home summarizes cases by status and links directly to the queues that need attention.',
        'Rohan Das (Demo)',
      ],
      [
        'Customer Experience',
        'Customer profile timeline',
        'Recent contact and active cases appear together so the team can understand context before replying.',
        'Ira Sen (Demo)',
      ],
      [
        'Product & Engineering',
        'Role-aware panel navigation',
        'Panel navigation shows only the tools available to the signed-in role.',
        'Neil Rao (Demo)',
      ],
    ],
  ],
  [
    'Hoora on Web',
    '2.6.1',
    '2026-10-29',
    [
      [
        'Auto Care',
        'Service page clarity',
        'Service pages explain the process, expected duration, and required customer details before the booking form.',
        'Tara Iyer (Demo)',
      ],
      [
        'Products & Accessories',
        'Catalog refinements',
        'Product listings keep pricing and compatibility details aligned across category pages.',
        'Aarav Kulkarni (Demo)',
      ],
      [
        'Product & Engineering',
        'Mobile layout adjustments',
        'Navigation, filters, and product cards remain readable on narrow phone screens.',
        'Nisha Roy (Demo)',
      ],
    ],
  ],
  [
    'Partner App',
    '1.4.1',
    '2026-10-28',
    [
      [
        'Garage Services',
        'Job acceptance checklist',
        'A short checklist confirms service scope, vehicle details, and slot before the partner accepts a job.',
        'Karan Joshi (Demo)',
      ],
      [
        'VSA',
        'Escalation response targets',
        'Escalations show the expected response window and the team currently responsible.',
        'Meera Pillai (Demo)',
      ],
      [
        'Operations',
        'Completed job summary',
        'Partners can review the work completed and pending customer communication before closeout.',
        'Samir Rao (Demo)',
      ],
    ],
  ],
];
const docs = [
  [
    'demo-customer-booking-playbook',
    'documentation',
    'Demo: Customer booking journey',
    'Auto Care',
    '2026-11-06',
    '# Purpose\n\nUse this playbook to review the customer booking journey from service discovery through confirmation. This is fictional demo content for exploring the knowledge hub.\n\n# Customer flow\n\n1. Select a service package and review its inclusions.\n2. Choose a vehicle and service address.\n3. Compare available slots and select a time.\n4. Review price, duration, and booking details.\n5. Confirm and follow the service status from the request page.\n\n# Expected outcome\n\nThe customer can understand the service, confirm an available time, and find the next step without contacting support.',
  ],
  [
    'demo-garage-handover-sop',
    'sop',
    'Demo: Garage service handover',
    'Garage Services',
    '2026-11-06',
    '# Before handover\n\nConfirm the inspection and agreed work are recorded against the correct vehicle and booking. This sample is not an approved Hoora procedure.\n\n# Handover checklist\n\n- Summarize completed work in customer-friendly language.\n- Record any work that was not completed and why.\n- Confirm the vehicle and belongings are ready for collection.\n- Explain the next recommended action, if applicable.\n\n# Close the job\n\nShare the summary with the customer, record the handover time, and close the job only after required notes are complete.',
  ],
  [
    'demo-panel-exception-triage',
    'sop',
    'Demo: Panel exception triage',
    'Operations',
    '2026-11-06',
    '# Purpose\n\nUse this sample guide to show how an internal operating procedure can be structured. It is demo content and does not replace an approved process.\n\n# Triage steps\n\n1. Confirm the customer, booking, and vehicle identifiers.\n2. Read the latest status and previous owner notes.\n3. Set the case priority based on impact and deadline.\n4. Assign an owner and record the next action.\n\n# Escalate\n\nEscalate cases with safety, payment, or time-critical impact to the relevant operational lead. Record the reason and expected response time.',
  ],
  [
    'demo-partner-job-acceptance',
    'documentation',
    'Demo: Partner job acceptance',
    'VSA',
    '2026-11-06',
    '# Purpose\n\nThis sample guide demonstrates partner-facing content and is not a live operating instruction.\n\n# Review before accepting\n\n- Confirm the service scope and requested time.\n- Check vehicle details and service coverage.\n- Review any customer notes that affect the job.\n- Accept only when capacity and required equipment are available.\n\n# After acceptance\n\nKeep the job status current and notify the operations team if availability changes. Add a clear reason when returning a job to the queue.',
  ],
];

const projectByName = {};
for (const [name, icon, color, sectionNames] of apps) {
  let project = await one('docs_projects', 'name', name);
  if (!project)
    project = await insert('docs_projects', {
      name,
      icon,
      color,
      visibility: 'public',
      description: `Release history for ${name}.`,
    });
  if (name === 'Partner App' && project.description?.includes('Sample application'))
    project = await api('docs_projects', `?id=eq.${project.id}`, 'PATCH', {
      description: 'Partner experience releases.',
    }).then((rows) => rows[0] || project);
  projectByName[name] = project;
  const existing = await api(
    'docs_project_sections',
    `?project_id=eq.${project.id}&select=vertical_id`,
  );
  for (const [index, sectionName] of sectionNames.entries()) {
    const section = sections[sectionName];
    if (!section) throw new Error(`Missing section: ${sectionName}`);
    if (!existing.some((row) => row.vertical_id === section.id))
      await insert('docs_project_sections', {
        project_id: project.id,
        vertical_id: section.id,
        sort_order: index,
        active: true,
      });
  }
}

let created = 0;
for (const [appName, version, date, notes] of examples) {
  const project = projectByName[appName];
  const slug = `demo-${appName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')}-${version.replace(/[^a-z0-9]+/gi, '-')}`;
  const published = await one('docs_published', 'slug', slug);
  if (published) continue;
  let page = await one('docs_pages', 'slug', slug);
  const conflict = await api(
    'docs_releases',
    `?project_id=eq.${project.id}&version=eq.${encodeURIComponent(version)}&select=id`,
  );
  if (conflict.length && (!page || conflict[0].id !== page.id)) continue;
  const id = page?.id || randomUUID(),
    timestamp = `${date}T10:00:00+05:30`;
  const title = `${appName} · v${version}`;
  const summary =
    'Demo release showing how platform changes are grouped by section and credited to contributors.';
  const body = notes
    .map(([sectionName, heading, content]) => `## ${sectionName}\n\n### ${heading}\n\n${content}`)
    .join('\n\n');
  if (!page)
    page = await insert('docs_pages', {
      id,
      slug,
      title,
      kind: 'release',
      summary,
      version,
      body,
      tags: ['sample'],
      visibility: 'public',
      format: 'markdown',
      created_at: timestamp,
    });
  if (!conflict.length) await insert('docs_releases', { id, project_id: project.id, version });
  const existingEntries = await api('docs_entries', `?release_id=eq.${id}&select=title`);
  const missing = notes.filter(
    ([, heading]) => !existingEntries.some((row) => row.title === heading),
  );
  if (missing.length) {
    // The real author trigger must remain in force for normal users. This transaction
    // blocks concurrent writes while inserting clearly marked fictional sample authors.
    await client.query('begin');
    try {
      await client.query('alter table public.docs_entries disable trigger docs_entry_stamp');
      for (const [sectionName, heading, content, author] of missing) {
        const by = author;
        await client.query(
          'insert into public.docs_entries(release_id,vertical_id,title,body,author_name,updated_name,submitted,created_at,updated_at) values($1,$2,$3,$4,$5,$5,true,$6,$6)',
          [id, sections[sectionName].id, heading, content, by, timestamp],
        );
      }
      await client.query('alter table public.docs_entries enable trigger docs_entry_stamp');
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    }
  }
  const storedEntries = await api('docs_entries', `?release_id=eq.${id}&select=*`);
  const entries = storedEntries.map((entry) => {
    const section = Object.values(sections).find((item) => item.id === entry.vertical_id);
    return {
      id: entry.id,
      vertical_id: section.id,
      vertical: section.name,
      vertical_icon: section.icon,
      vertical_color: section.color,
      title: entry.title,
      body: entry.body,
      author: entry.author_name,
      edited_by: entry.updated_name,
      updated_at: timestamp,
    };
  });
  page = await one('docs_pages', 'id', id);
  await insert('docs_published', {
    id,
    slug,
    title,
    kind: 'release',
    summary,
    version,
    body,
    tags: ['sample'],
    revision: page.revision,
    visibility: 'public',
    project_id: project.id,
    format: 'markdown',
    published_at: timestamp,
    release_snapshot: {
      project: appName,
      project_slug: appName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, ''),
      project_icon: project.icon,
      project_color: project.color,
      version,
      sample: true,
      entries,
    },
  });
  created++;
}
for (const [slug, kind, title, sectionName, date, body] of docs) {
  if (await one('docs_published', 'slug', slug)) continue;
  let page = await one('docs_pages', 'slug', slug);
  const id = page?.id || randomUUID(),
    timestamp = `${date}T10:00:00+05:30`;
  const row = {
    id,
    slug,
    title,
    kind,
    summary: 'Example internal document for exploring Hoora Docs. Not an approved company policy.',
    body,
    version: '',
    tags: ['sample'],
    vertical_id: sections[sectionName].id,
    visibility: 'private',
    format: 'markdown',
  };
  if (!page) page = await insert('docs_pages', { ...row, created_at: timestamp });
  await insert('docs_published', { ...row, revision: page.revision, published_at: timestamp });
  created++;
}
const removed = await client.query(
  "delete from public.docs_pages where coalesce(tags, '{}'::text[]) @> array['sample']::text[] and slug not like 'demo-%' returning slug",
);
console.log(
  `Demo refresh complete: 12 platform releases and 4 knowledge docs created; ${removed.rowCount} older tagged demo pages removed. Company-authored content was preserved.`,
);
await client.end();
