/*
 * Rebuilds demo content without dropping schema or deleting existing employee
 * accounts. Run with `node scripts/reset-demo.mjs` after loading .env.
 */
import { loadEnvFile } from 'node:process';
import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { databaseOptions } from './database-options.mjs';

loadEnvFile();
const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey)
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');

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

const password = () => `Hoora!${randomBytes(7).toString('base64url')}9`;
const demoAccounts = [
  ['hoora-demo-admin@hoora.me', 'Demo Admin', 'admin'],
  ['hoora-demo-manager@hoora.me', 'Demo Manager', 'manager'],
  ['hoora-demo-publisher@hoora.me', 'Demo Publisher', 'publisher'],
  ['hoora-demo-viewer@hoora.me', 'Demo Viewer', 'viewer'],
];
const credentials = [];
const users = {};
const existing = await api('/auth/v1/admin/users?per_page=100');
for (const [email, name, role] of demoAccounts) {
  const found = existing.users?.find((user) => user.email?.toLowerCase() === email);
  const pass = password();
  const body = {
    email,
    password: pass,
    email_confirm: true,
    user_metadata: { name, demo: true },
  };
  const user = found
    ? await api(`/auth/v1/admin/users/${found.id}`, { method: 'PUT', body: JSON.stringify(body) })
    : await api('/auth/v1/admin/users', { method: 'POST', body: JSON.stringify(body) });
  users[email] = user;
  credentials.push({ email, password: pass, role });
}

const client = new pg.Client(databaseOptions());
await client.connect();
const q = (text, values = []) => client.query(text, values);
const scalar = async (text, values = []) => (await q(text, values)).rows[0];
const memberId = (email) => users[email].id;

try {
  await q('begin');
  // Service-role seeding has no auth.uid(); preserve the explicit demo authors.
  await q('alter table public.docs_entries disable trigger docs_entry_stamp');
  // Content-only purge. Audit history, schema, and existing non-demo auth users remain.
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
           delete from public.docs_releases;
           delete from public.docs_entries;
           delete from public.docs_slug_aliases;
           delete from public.docs_mail_tests;
           delete from public.docs_pages;
           delete from public.docs_project_sections;
           delete from public.docs_projects;
           delete from public.docs_folders;
           delete from public.docs_teams;
           delete from public.docs_upcoming_releases;
           delete from public.docs_team_permissions;`);

  // Keep the four canonical release categories and remove stale sample categories.
  await q('delete from public.docs_verticals');
  const verticals = {};
  const verticalRows = [
    ['Auto Care', 'Vehicle care experiences', 'car', 'blue'],
    ['Car Repair & Services', 'Garage, repair, and service journeys', 'tool', 'orange'],
    ['Products', 'Products, accessories, and fitment', 'bag', 'violet'],
    ['Value-added Services', 'Advisor and value-added service workflows', 'users', 'green'],
  ];
  for (const [name, description, icon, color] of verticalRows) {
    const row = await scalar(
      'insert into public.docs_verticals(name,description,icon,color) values($1,$2,$3,$4) returning *',
      [name, description, icon, color],
    );
    verticals[name] = row;
  }

  for (const [email, name, role] of demoAccounts) {
    await q(
      `insert into public.docs_members(id,email,name,role,active,auth_source,password_setup_complete)
       values($1,$2,$3,$4,true,'password',true)
       on conflict(id) do update set email=excluded.email,name=excluded.name,role=excluded.role,active=true,auth_source='password',password_setup_complete=true`,
      [memberId(email), email, name, role],
    );
  }
  const admin = memberId(demoAccounts[0][0]);
  const manager = memberId(demoAccounts[1][0]);
  const publisher = memberId(demoAccounts[2][0]);

  const teamRows = [
    ['Product Team', 'product-team'],
    ['Operations Team', 'operations-team'],
    ['Customer Experience Team', 'customer-experience-team'],
    ['Technology Team', 'technology-team'],
  ];
  const teams = {};
  for (const [name, slug] of teamRows) {
    const row = await scalar(
      'insert into public.docs_teams(name,slug,manager_id) values($1,$2,$3) returning *',
      [name, slug, manager],
    );
    teams[slug] = row;
  }
  for (const team of Object.values(teams)) {
    const members = [
      [demoAccounts[0][0], 'manager'],
      [demoAccounts[1][0], 'manager'],
      [demoAccounts[2][0], 'publisher'],
      [demoAccounts[3][0], 'viewer'],
    ];
    for (const [email, role] of members)
      await q(
        'insert into public.docs_team_members(team_id,email,role,added_by) values($1,$2,$3,$4)',
        [team.id, email, role, admin],
      );
  }

  const folders = {};
  for (const [name, slug, teamSlug] of [
    ['Release notes', 'release-notes', 'product-team'],
    ['Upcoming releases', 'upcoming-releases', 'product-team'],
    ['SOPs', 'sops', 'operations-team'],
    ['Documentation', 'documentation', 'technology-team'],
  ]) {
    folders[slug] = await scalar(
      `insert into public.docs_folders(name,slug,visibility,icon,color,team_id)
       values($1,$2,'private','folder','slate',$3) returning *`,
      [name, slug, teams[teamSlug].id],
    );
  }

  const projects = {};
  const platforms = [
    ['Customer App', 'customer-app', 'phone', 'blue', 'product-team'],
    ['Panels', 'panels', 'settings', 'slate', 'operations-team'],
    ['Partner App', 'partner-app', 'tool', 'slate', 'customer-experience-team'],
    ['Hoora Web', 'hoora-web', 'web', 'slate', 'technology-team'],
  ];
  for (const [name, slug, icon, color] of platforms) {
    projects[slug] = await scalar(
      "insert into public.docs_projects(name,slug,description,visibility,icon,color) values($1,$2,$3,'private',$4,$5) returning *",
      [name, slug, `Global release history for ${name}.`, icon, color],
    );
    for (const [index, vertical] of Object.values(verticals).entries())
      await q(
        'insert into public.docs_project_sections(project_id,vertical_id,sort_order,active) values($1,$2,$3,true)',
        [projects[slug].id, vertical.id, index],
      );
  }

  const releaseTemplates = [
    [
      '6.0.0',
      '2026-11-07',
      'A cleaner release workspace with faster navigation and clearer ownership.',
    ],
    ['5.9.0', '2026-11-01', 'Improved release visibility, search, and service status details.'],
    [
      '5.8.0',
      '2026-10-24',
      'More consistent workflows across customer, partner, and internal tools.',
    ],
  ];
  const authors = [
    [
      'Auto Care',
      'Booking summary improvements',
      'Customers can compare service scope, duration, and next steps before confirming a booking.',
      'HCUS-1601',
    ],
    [
      'Car Repair & Services',
      'Service handover timeline',
      'Inspection, repair, and handover states are shown in one readable timeline.',
      'HCUS-1602',
    ],
    [
      'Products',
      'Fitment guidance',
      'Product pages now explain vehicle compatibility before checkout.',
      'HCUS-1603',
    ],
    [
      'Value-added Services',
      'Advisor follow-up queue',
      'Advisors can see the request, owner, and response due time together.',
      'HCUS-1604',
    ],
  ];
  for (const [platformName, platformSlug, icon, color, teamSlug] of platforms) {
    for (const [version, date, summary] of releaseTemplates) {
      const project = projects[platformSlug];
      const id = randomUUID();
      const slug = `${platformSlug}-${version.replaceAll('.', '-')}`;
      const body = authors
        .map(
          ([section, title, content, ticket]) =>
            `## ${section}\n\n### ${title}\n\n${content}\n\nTicket: ${ticket}`,
        )
        .join('\n\n');
      const entries = authors.map(([section, title, content, ticket]) => ({
        title,
        section,
        body: content,
        ticket,
        author: 'Rahul Tripathi',
      }));
      const page = await scalar(
        `insert into public.docs_pages(id,title,slug,kind,body,summary,version,tags,created_by,updated_by,visibility,folder_id,team_id,source_type)
         values($1,$2,$3,'release',$4,$5,$6,array['demo','release'], $7,$7,'private',$8,$9,'MARKDOWN') returning *`,
        [
          id,
          `${platformName} · v${version}`,
          slug,
          body,
          summary,
          version,
          admin,
          folders['release-notes'].id,
          teams['product-team'].id,
        ],
      );
      await q('insert into public.docs_releases(id,project_id,version) values($1,$2,$3)', [
        id,
        project.id,
        version,
      ]);
      for (const [index, [section, title, content, ticket]] of authors.entries())
        await q(
          `insert into public.docs_entries(release_id,vertical_id,title,body,tickets,submitted,author_id,author_name,updated_by,updated_name)
           values($1,$2,$3,$4,$5,true,$6,'Rahul Tripathi',$6,'Rahul Tripathi')`,
          [id, verticals[section].id, title, content, ticket, admin],
        );
      const snapshot = {
        project: platformName,
        project_slug: platformSlug,
        project_icon: icon,
        project_color: color,
        version,
        entries,
      };
      await q(
        `insert into public.docs_published(id,title,slug,kind,body,summary,version,tags,revision,format,release_snapshot,visibility,folder_id,project_id,published_by,published_by_name,team_id,owner_id,owner_name,source_type)
         values($1,$2,$3,'release',$4,$5,$6,array['demo','release'],$7,'markdown',$8,'private',$9,$10,$11,'Rahul Tripathi',$12,$11,'Rahul Tripathi','MARKDOWN')`,
        [
          page.id,
          page.title,
          page.slug,
          body,
          summary,
          version,
          page.revision,
          JSON.stringify(snapshot),
          folders['release-notes'].id,
          project.id,
          publisher,
          teams['product-team'].id,
        ],
      );
      await q(
        'insert into public.docs_project_sections(project_id,vertical_id,sort_order,active) select $1,id,row_number() over(order by name),true from public.docs_verticals on conflict do nothing',
        [project.id],
      );
    }
  }

  const docs = [
    [
      'booking-playbook',
      'Booking journey playbook',
      'Auto Care',
      'documentation',
      'Product teams can use this guide to review booking discovery, selection, confirmation, and status tracking.',
    ],
    [
      'garage-handover',
      'Garage service handover',
      'Car Repair & Services',
      'sop',
      'Confirm completed work, outstanding items, vehicle readiness, and the next customer action before closing a job.',
    ],
    [
      'fitment-guide',
      'Products and fitment guide',
      'Products',
      'documentation',
      'Product pages should show fitment, availability, delivery, and compatibility before checkout.',
    ],
    [
      'advisor-follow-up',
      'Value-added service follow-up',
      'Value-added Services',
      'sop',
      'Advisors should record the request, owner, due time, and customer-facing next step in the same thread.',
    ],
  ];
  for (const [slug, title, section, kind, body] of docs) {
    const id = randomUUID();
    const page = await scalar(
      `insert into public.docs_pages(id,title,slug,kind,vertical_id,body,summary,version,tags,created_by,updated_by,visibility,folder_id,team_id,source_type)
       values($1,$2,$3,$4,$5,$6,$7,'',array['demo','knowledge'],$8,$8,'private',$9,$10,'MARKDOWN') returning *`,
      [
        id,
        title,
        slug,
        kind,
        verticals[section].id,
        body,
        'Demo knowledge content for Hoora Assist.',
        admin,
        folders[kind === 'sop' ? 'sops' : 'documentation'].id,
        teams[kind === 'sop' ? 'operations-team' : 'technology-team'].id,
      ],
    );
    await q(
      `insert into public.docs_published(id,title,slug,kind,vertical_id,body,summary,version,tags,revision,format,visibility,folder_id,published_by,published_by_name,team_id,owner_id,owner_name,source_type)
       values($1,$2,$3,$4,$5,$6,$7,'',array['demo','knowledge'],$8,'markdown','private',$9,$10,'Rahul Tripathi',$11,$10,'Rahul Tripathi','MARKDOWN')`,
      [
        page.id,
        page.title,
        page.slug,
        page.kind,
        page.vertical_id,
        page.body,
        page.summary,
        page.revision,
        page.folder_id,
        publisher,
        page.team_id,
      ],
    );
  }

  // Every team can read the shared knowledge collections. Release publishing is
  // scoped to Product/Technology teams; managers retain SOP/documentation control.
  for (const team of Object.values(teams)) {
    for (const collection of ['sop', 'documentation'])
      await q(
        "insert into public.docs_team_permissions(team_id,scope_type,collection_key,capability,granted_by) values($1,'collection',$2,'contribute',$3)",
        [team.id, collection, admin],
      );
  }
  for (const slug of ['product-team', 'technology-team'])
    for (const project of Object.values(projects))
      await q(
        "insert into public.docs_team_permissions(team_id,scope_type,project_id,capability,granted_by) values($1,'project',$2,'publish',$3)",
        [teams[slug].id, project.id, admin],
      );

  await q('alter table public.docs_entries enable trigger docs_entry_stamp');
  await q('commit');
} catch (error) {
  await q('rollback');
  throw error;
} finally {
  await client.end();
}

console.log('\nHoora demo reset complete. Existing schema and employee accounts were preserved.');
console.log('Demo credentials (change these after testing):');
for (const account of credentials)
  console.log(`${account.role.padEnd(9)} ${account.email}  ${account.password}`);
console.log(
  'Seeded 4 platforms × 3 releases, four sections, four teams, scoped permissions, and four knowledge docs.',
);
