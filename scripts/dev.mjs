import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadEnvFile } from 'node:process';
import './prepare.mjs';
try {
  loadEnvFile();
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
}
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mjs': 'text/javascript',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json',
};
const root = path.resolve('public');
http
  .createServer(async (req, res) => {
    try {
      if (
        /^\/api\/(admin|sso|artifact|onboarding|notifications|push|content|cleanup|upcoming|assistant|ai-index|preview)(\?|$)/.test(
          req.url,
        )
      ) {
        const endpoint = new URL(req.url, 'http://localhost').pathname.split('/').at(-1);
        const { default: handler } = await import(`../api/${endpoint}.js`);
        res.status = (n) => {
          res.statusCode = n;
          return res;
        };
        res.json = (o) => {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(o));
        };
        res.send = (body) => res.end(body);
        let body = '';
        for await (const c of req) {
          body += c;
          if (body.length > 20000) throw new Error('Request too large');
        }
        req.body = body ? JSON.parse(body) : {};
        req.query = Object.fromEntries(new URL(req.url, 'http://localhost').searchParams);
        return await handler(req, res);
      }
      // Shared links get their preview tags, as the Vercel rewrites do in production.
      const url = new URL(req.url, 'http://localhost');
      const pagePreviews = {
        releases: 'releases',
        upcoming: 'upcoming',
        install: 'install',
        browse: 'library',
        workspace: 'library',
        home: 'home',
      };
      const shared = url.pathname.match(
        /^\/(?:release-notes\/([^/]+)\/([^/]+)|(docs|upcoming|artifact)\/([^/]+)|(releases|upcoming|install|browse|workspace|home))\/?$/,
      );
      if (shared) {
        const { default: handler } = await import('../api/preview.js');
        res.status = (n) => ((res.statusCode = n), res);
        res.send = (body) => res.end(body);
        req.query = shared[1]
          ? { type: 'release', version: shared[1], application: shared[2] }
          : shared[5]
            ? {
                type: 'page',
                page: pagePreviews[shared[5]],
                project: url.searchParams.get('project') || '',
              }
            : {
                type: { docs: 'doc', upcoming: 'upcoming', artifact: 'artifact' }[shared[3]],
                slug: shared[4],
              };
        return await handler(req, res);
      }
      if (req.url.split('?')[0] === '/config.js') {
        res.setHeader('Content-Type', 'text/javascript');
        return res.end(
          `export const config = ${JSON.stringify({ url: process.env.SUPABASE_URL, key: process.env.SUPABASE_ANON_KEY, microsoftEnabled: process.env.MICROSOFT_SSO_ENABLED === 'true' })};`,
        );
      }
      const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      const routeName = !path.extname(name) && name !== '/config.js' ? '/index.html' : name;
      const target = path.resolve(root, '.' + (routeName === '/' ? '/index.html' : routeName));
      if (!target.startsWith(root + path.sep)) {
        res.statusCode = 403;
        return res.end('Forbidden');
      }
      res.setHeader('Content-Type', types[path.extname(target)] || 'application/octet-stream');
      res.end(await readFile(target));
    } catch (e) {
      res.statusCode = 404;
      res.end('Not found');
    }
  })
  .listen(Number(process.env.PORT || 3000), '127.0.0.1', () =>
    console.log('Hoora Docs: http://localhost:' + (process.env.PORT || 3000)),
  );
