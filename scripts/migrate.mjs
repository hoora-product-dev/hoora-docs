import { databaseOptions } from './database-options.mjs';
import pg from 'pg';
import { loadEnvFile } from 'node:process';
import { readdir, readFile } from 'node:fs/promises';
try {
  loadEnvFile();
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const expected = 'jrjkxddjwcphdmjeqyfq';
if (process.env.SUPABASE_URL !== `https://${expected}.supabase.co`)
  throw Error('Migration stopped: this command is restricted to the Hoora Docs Supabase project.');
if (!process.env.SUPABASE_DB_PASSWORD)
  throw Error('Set SUPABASE_DB_PASSWORD in the gitignored local .env.');
const client = new pg.Client(databaseOptions());
try {
  await client.connect();
  await client.query('select pg_advisory_lock(84932043)');
  await client.query(
    'create table if not exists public.hoora_schema_migrations(name text primary key,applied_at timestamptz not null default now())',
  );
  const directory = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(directory)).filter((n) => /^\d+_.+\.sql$/.test(n)).sort()) {
    if (
      (await client.query('select 1 from public.hoora_schema_migrations where name=$1', [name]))
        .rowCount
    )
      continue;
    const source = await readFile(new URL(name, directory), 'utf8');
    const match = /^\s*begin;([\s\S]*)commit;\s*$/i.exec(source);
    if (!match) throw Error('Migration must be transactional: ' + name);
    await client.query('begin');
    try {
      await client.query(match[1]);
      await client.query('insert into public.hoora_schema_migrations(name) values($1)', [name]);
      await client.query('commit');
      console.log('Applied ' + name);
    } catch (error) {
      await client.query('rollback');
      throw error;
    }
  }
  console.log('Hoora Docs schema is current.');
} finally {
  await client.query('select pg_advisory_unlock(84932043)').catch(() => {});
  await client.end();
}
