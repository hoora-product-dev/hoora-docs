import { cp, mkdir, writeFile, rm, readFile, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
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

// Fingerprinted app code: the app and its stylesheet get names derived from their
// content, so browsers keep them for a year and a new deploy is picked up at once
// (the page that names them is always checked). The editor, drawing tool and PDF
// viewer are already built separately and stay at /vendor.
const app = await build({
  entryPoints: ['dist/app.js'],
  outdir: 'dist/assets',
  entryNames: '[name]-[hash]',
  chunkNames: 'chunks/[name]-[hash]',
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'browser',
  minify: true,
  metafile: true,
  legalComments: 'none',
  plugins: [
    {
      name: 'vendor-stays-put',
      setup(plugin) {
        // The large, on-demand tools load their own fonts and files from /vendor.
        plugin.onResolve(
          { filter: /(^|\/)vendor\/(drawing\/|pdf-viewer|rich-editor|oauth)/ },
          (args) => ({ path: '/vendor/' + args.path.split('vendor/').pop(), external: true }),
        );
      },
    },
  ],
});
const appFile = Object.keys(app.metafile.outputs).find(
  (file) => app.metafile.outputs[file].entryPoint === 'dist/app.js',
);
const css = await readFile('dist/vendor/ui.css');
const cssFile = `dist/assets/ui-${createHash('sha256').update(css).digest('hex').slice(0, 10)}.css`;
await copyFile('dist/vendor/ui.css', cssFile);
const page = (await readFile('dist/index.html', 'utf8'))
  .replace('src="/app.js"', `src="/${appFile.replace(/^dist\//, '')}"`)
  .replace('href="/vendor/ui.css"', `href="/${cssFile.replace(/^dist\//, '')}"`);
if (!page.includes('/assets/app-') || !page.includes('/assets/ui-'))
  throw new Error('The page could not be pointed at the fingerprinted app files.');
await writeFile('dist/index.html', page);
console.log(`App code: /${appFile.replace(/^dist\//, '')} and /${cssFile.replace(/^dist\//, '')}`);
console.log('Hoora Docs built. Only the public Supabase key is included in browser assets.');
