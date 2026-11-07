import { cp, mkdir, writeFile, rm } from 'node:fs/promises';
import { loadEnvFile } from 'node:process';
import './prepare.mjs';
try {
  loadEnvFile();
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
}
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_ANON_KEY;
if (!url || !key) throw new Error('Set SUPABASE_URL and SUPABASE_ANON_KEY before building.');
if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url)) throw new Error('Invalid Supabase URL');
// Use the fixed project output directory so stale assets cannot survive a build.
const output = new URL('../dist/', import.meta.url);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp('public', 'dist', { recursive: true });
await writeFile(
  'dist/config.js',
  `export const config = ${JSON.stringify({ url, key, microsoftEnabled: process.env.MICROSOFT_SSO_ENABLED === 'true' })};\n`,
);
console.log('Hoora Docs built. Only the public Supabase key is included in browser assets.');
