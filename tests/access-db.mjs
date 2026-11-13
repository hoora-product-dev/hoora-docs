/**
 * Transactional access regression for the unified access model, devices and
 * daily maintenance. Migrations and fixtures run inside one transaction that is
 * always rolled back, so the shared production database is never changed.
 */
import pg from 'pg';
import { loadEnvFile } from 'node:process';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { databaseOptions } from '../scripts/database-options.mjs';
loadEnvFile();

const directory = new URL('../supabase/migrations/', import.meta.url);
const client = new pg.Client(databaseOptions());
let checks = 0;
const ok = (actual, expected, message) => {
  assert.deepEqual(actual, expected, message);
  checks++;
};

let fixtureOwner = null;
const claims = (member) =>
  client.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: member.id, role: 'authenticated', email: member.email }),
  ]);
/** Act as a signed-in member for the next statements (RLS applies), then return to the fixture owner. */
async function as(member, work, session = null) {
  await client.query('savepoint act');
  await client.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({
      sub: member.id,
      role: 'authenticated',
      email: member.email,
      session_id: session,
    }),
  ]);
  await client.query('set local role authenticated');
  try {
    const result = await work();
    await client.query('release savepoint act');
    return result;
  } catch (error) {
    await client.query('rollback to savepoint act');
    throw error;
  } finally {
    await client.query('reset role');
    await claims(fixtureOwner);
  }
}
const rejects = async (work, pattern, message) => {
  await client.query('savepoint expect');
  try {
    await assert.rejects(work, pattern, message);
  } finally {
    await client.query('rollback to savepoint expect');
  }
  checks++;
};
const one = async (sql, params = []) => (await client.query(sql, params)).rows[0];

try {
  await client.connect();
  await client.query('begin');
  const applied = new Set(
    (await client.query('select name from public.hoora_schema_migrations')).rows.map((r) => r.name),
  );
  const pending = (await readdir(directory)).filter((n) => /^\d+_.+\.sql$/.test(n)).sort();
  for (const name of pending.filter((n) => !applied.has(n))) {
    const source = await readFile(new URL(name, directory), 'utf8');
    const body = /^\s*begin;([\s\S]*)commit;\s*$/i.exec(source)?.[1];
    if (!body) throw Error('Migration must be transactional: ' + name);
    await client.query(body);
  }

  const admin = await one(
    "select id, email from public.docs_members where role='admin' and active and password_setup_complete order by created_at limit 1",
  );
  fixtureOwner = admin;
  await claims(admin);

  const person = async (label, role = 'viewer') => {
    const id = randomUUID(),
      email = `access-${label}-${id.slice(0, 8)}@hoora.me`;
    await client.query('insert into auth.users(id, email) values($1, $2)', [id, email]);
    await client.query(
      'insert into public.docs_members(id, email, name, role, active, password_setup_complete) values($1, $2, $3, $4, true, true)',
      [id, email, 'Access ' + label, role],
    );
    return { id, email };
  };
  const people = {
    managerA: await person('manager-a'),
    publisherA: await person('publisher-a'),
    editorA: await person('editor-a'),
    viewerA: await person('viewer-a'),
    viewerB: await person('viewer-b'),
    outsider: await person('outsider'),
    orgPublisher: await person('org-publisher', 'publisher'),
    orgManager: await person('org-manager', 'manager'),
  };
  const teamA = randomUUID(),
    teamB = randomUUID();
  for (const [id, name] of [
    [teamA, 'Access team A'],
    [teamB, 'Access team B'],
  ])
    await client.query(
      'insert into public.docs_teams(id, name, slug, manager_id) values($1, $2, $3, $4)',
      [id, name, 'access-' + id, admin.id],
    );
  for (const [key, role] of [
    ['managerA', 'manager'],
    ['publisherA', 'publisher'],
    ['editorA', 'contributor'],
    ['viewerA', 'viewer'],
  ])
    await client.query(
      'insert into public.docs_team_members(team_id, email, role, added_by) values($1, $2, $3, $4)',
      [teamA, people[key].email, role, admin.id],
    );
  await client.query(
    "insert into public.docs_team_members(team_id, email, role, added_by) values($1, $2, 'viewer', $3)",
    [teamB, people.viewerB.email, admin.id],
  );
  ok(
    (await one('select count(*)::int n from public.docs_team_members where team_id=$1', [teamA])).n,
    4,
    'administrator-created teams do not add the administrator as a member',
  );

  const page = async (kind, { team = null, folder = null, restricted = false } = {}) => {
    const id = randomUUID();
    await client.query(
      'insert into public.docs_pages(id, title, slug, kind, team_id, folder_id, body, created_by) values($1, $2, $3, $4, $5, $6, $7, $8)',
      [id, 'Access ' + kind, 'access-' + id, kind, team, folder, 'Body', admin.id],
    );
    if (restricted) {
      await client.query("select set_config('hoora.access_change', 'on', true)");
      await client.query("update public.docs_pages set visibility='restricted' where id=$1", [id]);
      await client.query("select set_config('hoora.access_change', '', true)");
    }
    await client.query('select public.docs_publish_snapshot($1)', [id]);
    return id;
  };
  const folder = randomUUID(),
    subfolder = randomUUID();
  await client.query(
    "insert into public.docs_folders(id, name, slug, visibility) values($1, 'Access F', $2, 'private')",
    [folder, 'access-f-' + folder.slice(0, 8)],
  );
  await client.query(
    "insert into public.docs_folders(id, name, slug, visibility, parent_id) values($1, 'Access F2', $2, 'private', $3)",
    [subfolder, 'access-f2-' + subfolder.slice(0, 8), folder],
  );
  const teamSop = await page('sop', { team: teamA });
  const restrictedSop = await page('sop', { team: teamA, restricted: true });
  const companyDoc = await page('documentation');
  const folderDoc = await page('documentation', { folder, restricted: true });
  const nestedDoc = await page('documentation', { folder: subfolder, restricted: true });
  // Authorship is Manage; these fixtures were created by the administrator.
  const level = async (doc, who) =>
    (await one('select public.docs_page_level($1, $2) l', [doc, people[who].id])).l;

  const expected = {
    [teamSop]: {
      managerA: 4,
      publisherA: 3,
      editorA: 2,
      viewerA: 1,
      viewerB: 0,
      outsider: 0,
      orgPublisher: 0,
    },
    [restrictedSop]: {
      managerA: 4,
      publisherA: 0,
      editorA: 0,
      viewerA: 0,
      viewerB: 0,
      outsider: 0,
    },
    [companyDoc]: { managerA: 1, viewerA: 1, outsider: 1, orgPublisher: 3, orgManager: 1 },
    [folderDoc]: { outsider: 0, orgPublisher: 0, viewerA: 0 },
  };
  for (const [doc, levels] of Object.entries(expected))
    for (const [who, value] of Object.entries(levels))
      ok(await level(doc, who), value, `${who} on fixture ${doc.slice(0, 8)}`);
  ok(await level(teamSop, 'viewerA'), 1, 'team viewers read team documents');
  ok(
    (await one('select public.docs_page_level($1, $2) l', [teamSop, admin.id])).l,
    4,
    'administrators manage everything',
  );

  // Grants: person, folder (inherited), collection (capped by team role), expiry.
  const grant = (args) =>
    client.query('select public.docs_grant_access($1, $2, $3, $4, $5, $6, $7) id', [
      args.team ?? null,
      args.email ?? null,
      args.type,
      args.key ?? null,
      args.target ?? null,
      args.level,
      args.expires ?? null,
    ]);
  await grant({ email: people.outsider.email, type: 'page', target: teamSop, level: 2 });
  ok(await level(teamSop, 'outsider'), 2, 'a person grant on one page');
  await grant({ email: people.outsider.email, type: 'folder', target: folder, level: 1 });
  ok(await level(folderDoc, 'outsider'), 1, 'a folder grant opens restricted documents inside it');
  ok(await level(nestedDoc, 'outsider'), 1, 'folder grants reach subfolders');
  await grant({ team: teamB, type: 'collection', key: 'sop', level: 2 });
  ok(await level(teamSop, 'viewerB'), 1, 'team grants are capped by the team role');
  ok(await level(restrictedSop, 'viewerB'), 1, 'collection grants include restricted documents');
  await client.query(
    "insert into public.docs_access_grants(email, target_type, page_id, level, expires_at) values($1, 'page', $2, 4, now() - interval '1 day')",
    [people.viewerA.email, restrictedSop],
  );
  ok(await level(restrictedSop, 'viewerA'), 0, 'expired grants are ignored');
  await rejects(
    () => grant({ email: 'someone@example.com', type: 'page', target: teamSop, level: 1 }),
    /hoora\.me/,
    'only Hoora emails',
  );

  // Row-level security: drafts open from Edit, writes need the right level.
  const draft = randomUUID();
  await client.query(
    "insert into public.docs_pages(id, title, slug, kind, team_id, body, created_by) values($1, 'Access draft', $2, 'sop', $3, 'Draft', $4)",
    [draft, 'access-' + draft, teamA, admin.id],
  );
  const sees = (who, id) =>
    as(
      people[who],
      async () =>
        (await client.query('select id from public.docs_pages where id=$1', [id])).rowCount,
    );
  ok(await sees('editorA', draft), 1, 'team editors open team drafts');
  ok(await sees('viewerA', draft), 0, 'team viewers do not see drafts');
  await grant({ email: people.outsider.email, type: 'page', target: draft, level: 2 });
  ok(await sees('outsider', draft), 1, 'a person Edit grant opens the draft');
  ok(
    await as(
      people.outsider,
      async () =>
        (await client.query("update public.docs_pages set body='Edited' where id=$1", [draft]))
          .rowCount,
    ),
    1,
    'a person Edit grant can save the draft',
  );
  await rejects(
    () => as(people.outsider, () => client.query('select public.docs_publish($1)', [draft])),
    /Publishing permission/,
    'Edit cannot publish',
  );
  ok(
    await as(people.editorA, async () => {
      const id = randomUUID();
      return (
        await client.query(
          "insert into public.docs_pages(id, title, slug, kind, team_id, body, created_by) values($1, 'New', $2, 'sop', $3, 'x', $4)",
          [id, 'access-' + id, teamA, people.editorA.id],
        )
      ).rowCount;
    }),
    1,
    'team editors create team documents (triggers still run after revoking direct execute)',
  );
  await rejects(
    () =>
      as(people.viewerA, () => {
        const id = randomUUID();
        return client.query(
          "insert into public.docs_pages(id, title, slug, kind, team_id, body, created_by) values($1, 'New', $2, 'sop', $3, 'x', $4)",
          [id, 'access-' + id, teamA, people.viewerA.id],
        );
      }),
    /row-level security/,
    'team viewers cannot create documents',
  );
  ok(
    await as(
      people.editorA,
      async () =>
        (await client.query('delete from public.docs_pages where id=$1', [teamSop])).rowCount,
    ),
    0,
    'Edit cannot delete',
  );

  // Team membership: only managers and administrators.
  await rejects(
    () =>
      as(people.viewerA, () =>
        client.query(
          "insert into public.docs_team_members(team_id, email, role, added_by) values($1, 'access-new@hoora.me', 'viewer', $2)",
          [teamA, people.viewerA.id],
        ),
      ),
    /row-level security/,
    'team viewers cannot add people',
  );
  ok(
    await as(
      people.editorA,
      async () =>
        (
          await client.query('delete from public.docs_team_members where team_id=$1 and email=$2', [
            teamA,
            people.viewerA.email,
          ])
        ).rowCount,
    ),
    0,
    'team editors cannot remove people',
  );
  ok(
    await as(
      people.managerA,
      async () =>
        (
          await client.query(
            "insert into public.docs_team_members(team_id, email, role, added_by) values($1, 'access-new@hoora.me', 'manager', $2)",
            [teamA, people.managerA.id],
          )
        ).rowCount,
    ),
    1,
    'team managers add people up to Manager',
  );
  ok(
    await as(
      people.managerA,
      async () =>
        (
          await client.query(
            "update public.docs_teams set name='Access team A renamed' where id=$1",
            [teamA],
          )
        ).rowCount,
    ),
    1,
    'team managers rename their team',
  );
  await rejects(
    () =>
      as(people.managerA, () =>
        client.query('update public.docs_teams set manager_id=$2 where id=$1', [
          teamA,
          people.managerA.id,
        ]),
      ),
    /administrator/,
    'only administrators change the team owner',
  );
  const created = randomUUID();
  await as(people.orgManager, () =>
    client.query(
      'insert into public.docs_teams(id, name, slug, manager_id) values($1, $2, $3, $4)',
      [created, 'Access created', 'access-created-' + created.slice(0, 8), people.orgManager.id],
    ),
  );
  ok(
    (
      await one('select role from public.docs_team_members where team_id=$1 and email=$2', [
        created,
        people.orgManager.email,
      ])
    )?.role,
    'manager',
    'a team creator manages the new team',
  );

  // Sharing and granting stay within the sharer's own level.
  await as(people.managerA, () =>
    client.query('select public.docs_share($1, $2, $3::jsonb)', [
      teamSop,
      'team',
      JSON.stringify([{ email: people.viewerB.email, level: 3 }]),
    ]),
  );
  ok(await level(teamSop, 'viewerB'), 3, 'team managers share a team document at Publish');
  ok(await level(teamSop, 'outsider'), 0, 'sharing replaces the previous page grants');
  await rejects(
    () =>
      as(people.publisherA, () =>
        client.query('select public.docs_share($1, $2, $3::jsonb)', [teamSop, 'team', '[]']),
      ),
    /Manage access/,
    'Publish cannot share',
  );
  await rejects(
    () =>
      as(people.managerA, () =>
        client.query(
          "select public.docs_grant_access(null, $1, 'collection', 'sop', null, 1::smallint, null)",
          [people.outsider.email],
        ),
      ),
    /Manage access/,
    'collection grants are for administrators',
  );
  await as(people.managerA, () =>
    client.query('select public.docs_share($1, $2, $3::jsonb)', [
      teamSop,
      'restricted',
      JSON.stringify([{ email: people.outsider.email }]),
    ]),
  );
  ok(await level(teamSop, 'outsider'), 1, 'sharing without a level gives View');
  ok(await level(teamSop, 'viewerA'), 0, 'restricted documents hide from the owner team');
  ok(
    await as(people.viewerA, async () =>
      (await client.query('select public.docs_members_last_active()')).rowCount,
    ).catch((error) => error.message),
    'Administrator access required',
    'last-active times are for administrators',
  );

  // Upcoming releases.
  await grant({ team: teamA, type: 'collection', key: 'upcoming', level: 3 });
  const upcoming = async (who) =>
    one('select public.docs_can_upcoming($1) v, public.docs_can_manage_upcoming($1) m', [
      people[who].id,
    ]);
  ok(await upcoming('viewerA'), { v: true, m: false }, 'team viewers see upcoming');
  ok(await upcoming('editorA'), { v: true, m: true }, 'team editors configure upcoming');
  ok(await upcoming('outsider'), { v: false, m: false }, 'upcoming is hidden by default');

  // Releases: start one with Publish on the platform.
  const project = randomUUID();
  await client.query(
    "insert into public.docs_projects(id, name, slug, visibility) values($1, $2, $3, 'private')",
    [project, 'Access app', 'access-app-' + project.slice(0, 8)],
  );
  await grant({ team: teamA, type: 'project', target: project, level: 3 });
  const release = await as(
    people.publisherA,
    async () =>
      (await client.query("select public.docs_create_release($1, '9.9.9') id", [project])).rows[0]
        .id,
  );
  ok(
    (await one('select team_id from public.docs_pages where id=$1', [release])).team_id,
    teamA,
    'the release belongs to the granting team',
  );
  ok(await level(release, 'editorA'), 2, 'team editors write release notes');
  ok(await level(release, 'outsider'), 1, 'everyone reads releases');
  await rejects(
    () =>
      as(people.editorA, () =>
        client.query("select public.docs_create_release($1, '9.9.10')", [project]),
      ),
    /Publishing permission/,
    'Edit cannot start a release',
  );
  await as(people.orgPublisher, () =>
    client.query("select public.docs_create_release($1, '9.9.11')", [project]),
  );
  checks++;

  // Access report.
  const report = await as(
    people.outsider,
    async () => (await client.query('select public.docs_access_report() r')).rows[0].r,
  );
  ok(report.pages[teamSop]?.level, 1, 'the report lists page levels');
  ok(report.folders[folder]?.level, 1, 'the report lists folder levels');
  await rejects(
    () =>
      as(people.outsider, () =>
        client.query('select public.docs_access_report($1)', [people.viewerA.id]),
      ),
    /Administrator/,
    'only administrators read someone else’s report',
  );

  // Devices: list, sign out, immediate loss of access, 30-day idle and replaced sessions.
  const session = async (
    who,
    { ago = '0 minutes', agent = 'Test browser', ip = '10.0.0.1' } = {},
  ) => {
    const id = randomUUID();
    await client.query(
      `insert into auth.sessions(id, user_id, created_at, updated_at, refreshed_at, user_agent, ip)
       values($1, $2, now() - $3::interval, now() - $3::interval, (now() - $3::interval) at time zone 'UTC', $4, $5::inet)`,
      [id, people[who].id, ago, agent, ip],
    );
    return id;
  };
  const current = await session('outsider');
  const other = await session('outsider', { agent: 'Phone', ip: '10.0.0.2' });
  const devices = await as(
    people.outsider,
    async () => (await client.query('select * from public.docs_my_devices()')).rows,
    current,
  );
  ok(devices.length, 2, 'devices list every session');
  ok(devices.find((d) => d.id === current)?.is_current, true, 'the current device is marked');
  ok(
    await as(
      people.outsider,
      async () => (await client.query('select public.docs_sign_out_other_devices() n')).rows[0].n,
      current,
    ),
    1,
    'sign out all other devices',
  );
  ok(
    (await one('select count(*)::int n from auth.sessions where id=$1', [other])).n,
    0,
    'the other device is gone',
  );
  await client.query('delete from auth.sessions where id=$1', [current]);
  ok(
    await as(
      people.outsider,
      async () => (await client.query('select public.docs_role() r')).rows[0].r,
      current,
    ),
    null,
    'a signed-out session loses access immediately',
  );
  const idle = await session('viewerA', { ago: '31 days' });
  const fresh = await session('viewerA', { ago: '29 days', agent: 'Other' });
  const replaced = await session('viewerA', { ago: '3 days', agent: 'Laptop', ip: '10.0.0.9' });
  const newer = await session('viewerA', { ago: '1 day', agent: 'Laptop', ip: '10.0.0.9' });
  await client.query(
    "insert into public.docs_audit_log(user_id, action, created_at) values($1, 'asset_viewed', now() - interval '8 days'), ($1, 'asset_viewed', now() - interval '6 days')",
    [people.viewerA.id],
  );
  const maintenance = (await client.query('select public.docs_daily_maintenance() r')).rows[0].r;
  const left = (
    await client.query('select id from auth.sessions where id = any($1::uuid[])', [
      [idle, fresh, replaced, newer],
    ])
  ).rows.map((r) => r.id);
  ok(left.sort(), [fresh, newer].sort(), 'idle and replaced sessions are removed');
  ok(
    maintenance.idle_sessions >= 1 && maintenance.replaced_sessions >= 1,
    true,
    'maintenance reports what it removed',
  );
  ok(
    (
      await one('select count(*)::int n from public.docs_audit_log where user_id=$1', [
        people.viewerA.id,
      ])
    ).n >= 1 &&
      (
        await one(
          "select count(*)::int n from public.docs_audit_log where user_id=$1 and created_at < now() - interval '7 days'",
          [people.viewerA.id],
        )
      ).n === 0,
    true,
    'activity keeps 7 days',
  );
  await rejects(
    () => as(people.viewerA, () => client.query('select public.docs_daily_maintenance()')),
    /permission denied/,
    'maintenance is server-only',
  );

  console.log(
    `PASS ${checks} access, sharing, team, release, device and retention checks. Everything rolled back.`,
  );
} finally {
  await client.query('rollback').catch(() => {});
  await client.end();
}
