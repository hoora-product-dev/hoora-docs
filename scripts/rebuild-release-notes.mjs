/*
 * Rebuilds release notes from a reviewed plan: one complete Markdown note per
 * section (vertical) for each platform version. Runs as an administrator so the
 * normal database triggers, permissions and publishing functions apply.
 *
 * Plan format: [{ project, version, date, source, sections: { "Auto Care": "markdown", ... } }]
 *
 * Preview: node scripts/rebuild-release-notes.mjs --plan plan.json
 * Apply:   node scripts/rebuild-release-notes.mjs --plan plan.json --apply
 * Publish: node scripts/rebuild-release-notes.mjs --plan plan.json --publish --apply
 */
import { loadEnvFile } from 'node:process';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { databaseOptions } from './database-options.mjs';

loadEnvFile();
const arg = (name) => process.argv[process.argv.indexOf(name) + 1];
const apply = process.argv.includes('--apply');
const publish = process.argv.includes('--publish');
const planPath = arg('--plan');
if (!planPath || !process.argv.includes('--plan')) throw Error('Pass --plan <file.json>.');
const plan = JSON.parse(readFileSync(planPath, 'utf8'));

// Section names before and after migration 202611070017.
const aliases = {
  'Car Services & Repair': ['Car Services & Repair', 'Car Repair & Services'],
  'Value Added Services': ['Value Added Services', 'Value-added Services'],
};

const client = new pg.Client(databaseOptions());
await client.connect();
const q = (text, values = []) => client.query(text, values);
const one = async (text, values = []) => (await q(text, values)).rows[0];
try {
  const admin = await one(
    "select id,name from public.docs_members where lower(email)='rahul@hoora.me' and role='admin' and active",
  );
  if (!admin) throw Error('An active administrator account is required.');
  const verticals = (await q('select id,name from public.docs_verticals')).rows;
  const vertical = (name) =>
    verticals.find((v) => (aliases[name] || [name]).includes(v.name)) ||
    (() => {
      throw Error('Unknown section: ' + name);
    })();
  const folder = await one("select id from public.docs_folders where slug='release-notes'");

  await q('begin');
  await q("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: admin.id, role: 'authenticated' }),
  ]);
  for (const release of plan) {
    const project = await one('select id,name,slug from public.docs_projects where slug=$1', [
      release.project,
    ]);
    if (!project) throw Error('Unknown platform: ' + release.project);
    let row = await one(
      'select r.id from public.docs_releases r where r.project_id=$1 and r.version=$2',
      [project.id, release.version],
    );
    const label = `${project.name} v${release.version}`;
    if (publish) {
      if (!row) throw Error(label + ' does not exist yet. Run without --publish first.');
      await q('select public.docs_publish($1)', [row.id]);
      await q(
        `update public.docs_published set published_at=$2::date + time '12:00' at time zone 'Asia/Kolkata',
           source_url=$3, source_type='MARKDOWN', published_by=$4, published_by_name=$5, owner_id=$4, owner_name=$5
         where id=$1`,
        [
          row.id,
          release.date,
          /^https?:/.test(release.source) ? release.source : null,
          admin.id,
          admin.name,
        ],
      );
      await q('delete from public.docs_ai_chunks where document_id=$1', [row.id]);
      console.log('Published ' + label);
      continue;
    }
    if (!row) {
      const created = await one('select public.docs_create_release($1,$2,$3) as id', [
        project.id,
        release.version,
        '',
      ]);
      row = { id: created.id };
      const sibling = await one(
        `select p.team_id from public.docs_pages p join public.docs_releases r on r.id=p.id
         where r.project_id=$1 and p.team_id is not null limit 1`,
        [project.id],
      );
      await q('update public.docs_pages set team_id=$2, created_at=$3 where id=$1', [
        row.id,
        sibling?.team_id || null,
        release.date,
      ]);
      console.log('Created ' + label);
    }
    const names = Object.keys(release.sections);
    const changes = Object.values(release.sections).reduce(
      (total, body) => total + (body.match(/^### /gm) || []).length,
      0,
    );
    await q(
      `update public.docs_pages set body='', summary=$2, folder_id=$3, tags=array['release'],
         source_url=$4, source_type='MARKDOWN' where id=$1`,
      [
        row.id,
        `${changes} changes across ${names.join(', ')}.`,
        folder?.id || null,
        /^https?:/.test(release.source) ? release.source : null,
      ],
    );
    await q('delete from public.docs_entries where release_id=$1', [row.id]);
    for (const [name, body] of Object.entries(release.sections))
      await q(
        `insert into public.docs_entries(release_id,vertical_id,title,body,tickets,submitted)
         values($1,$2,$3,$4,'',true)`,
        [row.id, vertical(name).id, vertical(name).name, body],
      );
    console.log(`${label}: ${names.length} section notes, ${changes} changes`);
  }
  if (apply) {
    await q('commit');
    console.log(publish ? 'Published every planned release.' : 'Release notes rebuilt.');
  } else {
    await q('rollback');
    console.log('Dry run only. Re-run with --apply to keep these changes.');
  }
} catch (error) {
  await q('rollback').catch(() => {});
  throw error;
} finally {
  await client.end();
}
