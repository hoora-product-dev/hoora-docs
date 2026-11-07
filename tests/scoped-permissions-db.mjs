/** Transactional permission regression. Fixtures and migration are always rolled back. */
import pg from 'pg';
import { loadEnvFile } from 'node:process';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { databaseOptions } from '../scripts/database-options.mjs';
loadEnvFile();
const client = new pg.Client(databaseOptions());
try {
  await client.connect();
  await client.query('begin');
  const migration = await readFile(
    new URL(
      '../supabase/migrations/202611070015_permission_capability_ceiling.sql',
      import.meta.url,
    ),
    'utf8',
  );
  await client.query(migration.replace(/^begin;/, '').replace(/commit;\s*$/, ''));
  const roleCeiling = await readFile(
    new URL('../supabase/migrations/202611070016_document_role_ceiling.sql', import.meta.url),
    'utf8',
  );
  await client.query(roleCeiling.replace(/^begin;/, '').replace(/commit;\s*$/, ''));
  const {
    rows: [admin],
  } = await client.query(
    "select id from public.docs_members where role='admin' and active and password_setup_complete limit 1",
  );
  await client.query("select set_config('request.jwt.claim.sub',$1,true)", [admin.id]);
  const team = randomUUID(),
    manager = randomUUID();
  const people = {};
  for (const role of ['manager', 'publisher', 'contributor', 'viewer']) {
    const id = role === 'manager' ? manager : randomUUID(),
      email = `audit-${id}@hoora.me`;
    await client.query('insert into auth.users(id,email) values($1,$2)', [id, email]);
    await client.query(
      "insert into public.docs_members(id,email,name,role,active,password_setup_complete) values($1,$2,'Transactional audit','viewer',true,true) on conflict(id) do update set active=true,password_setup_complete=true,role='viewer'",
      [id, email],
    );
    people[role] = { id, email };
  }
  await client.query('insert into public.docs_teams(id,name,slug,manager_id) values($1,$2,$3,$4)', [
    team,
    'Transactional audit',
    'audit-' + team,
    manager,
  ]);
  for (const [role, person] of Object.entries(people))
    await client.query(
      'insert into public.docs_team_members(team_id,email,role,added_by) values($1,$2,$3,$4)',
      [team, person.email, role, admin.id],
    );
  const capabilities = ['read', 'contribute', 'edit', 'publish', 'manage', 'delete'];
  let assertions = 0;
  for (const grant of capabilities) {
    await client.query('delete from public.docs_team_permissions where team_id=$1', [team]);
    await client.query(
      "insert into public.docs_team_permissions(team_id,scope_type,collection_key,capability,granted_by) values($1,'collection','release',$2,$3)",
      [team, grant, admin.id],
    );
    for (const [role, person] of Object.entries(people))
      for (const [i, wanted] of capabilities.entries()) {
        const roleCeiling = { manager: 6, publisher: 4, contributor: 3, viewer: 1 }[role];
        const expected = i === 0 || (i + 1 <= roleCeiling && i <= capabilities.indexOf(grant));
        const {
          rows: [result],
        } = await client.query(
          "select public.docs_has_team_permission($1,'release',null,null,$2,$3) as allowed",
          [team, wanted, person.id],
        );
        assert.equal(result.allowed, expected, `${role} with ${grant} requesting ${wanted}`);
        assertions++;
      }
  }
  await client.query('delete from public.docs_team_permissions where team_id=$1', [team]);
  for (const [role, person] of Object.entries(people)) {
    const {
      rows: [result],
    } = await client.query(
      "select public.docs_has_team_permission($1,'release',null,null,'edit',$2) as releases,public.docs_has_team_permission($1,'documentation',null,null,'edit',$2) as docs,public.docs_has_team_permission($1,'documentation',null,null,'publish',$2) as publish",
      [team, person.id],
    );
    assert.equal(result.releases, false);
    assert.equal(result.docs, role !== 'viewer');
    assert.equal(result.publish, ['manager', 'publisher'].includes(role));
    const {
      rows: [deletion],
    } = await client.query(
      "select public.docs_has_team_permission($1,'documentation',null,null,'delete',$2) as allowed",
      [team, person.id],
    );
    assert.equal(deletion.allowed, false);
  }
  // Verify the public RPC uses the publishing check rather than the editing check.
  for (const name of ['docs_publish', 'docs_unpublish']) {
    const {
      rows: [result],
    } = await client.query('select pg_get_functiondef($1::regprocedure) as definition', [
      `public.${name}(uuid)`,
    ]);
    assert.match(result.definition, /docs_can_publish_page_for/);
  }
  console.log(
    `PASS ${assertions} grant/role checks, default documentation rights, release isolation, publishing gates. All fixtures rolled back.`,
  );
} finally {
  await client.query('rollback').catch(() => {});
  await client.end();
}
