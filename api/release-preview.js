import { readFile } from 'node:fs/promises';

// Platform slugs are managed in the database; validate the shape only.
const platformSlug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character],
  );

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(405).end();
  const application = String(
    Array.isArray(req.query.application) ? req.query.application[0] : req.query.application || '',
  ).toLowerCase();
  const rawVersion = String(
    Array.isArray(req.query.version) ? req.query.version[0] : req.query.version || '',
  ).replace(/^v/i, '');
  if (!platformSlug.test(application) || !/^\d+(?:\.\d+){0,3}(?:-[a-z0-9.-]+)?$/i.test(rawVersion))
    return res.status(404).send('Release not found');
  // Release links are organization-only. Keep unauthenticated HTML metadata generic so
  // crawlers and link previews cannot disclose release titles or versions.
  const title = 'Hoora Docs — Microsoft sign-in required';
  const description = 'Sign in with your Hoora Microsoft account to view this release.';
  const origin = `https://${req.headers['x-forwarded-host'] || req.headers.host}`;
  const canonical = `${origin}/release-notes/${encodeURIComponent(rawVersion)}/${encodeURIComponent(application)}`;
  let html;
  try {
    html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
  } catch {
    return res.status(503).send('Release page is temporarily unavailable.');
  }
  const titleTag = `<title>${escapeHtml(title)}</title>`;
  const descriptionTag = `<meta name="description" content="${escapeHtml(description)}" />`;
  html = html
    .replace(/<title>[\s\S]*?<\/title>/i, titleTag)
    .replace(/<meta\s+name="description"[^>]*>/i, descriptionTag)
    .replace(
      '</head>',
      `<link rel="canonical" href="${escapeHtml(canonical)}" />
<meta property="og:type" content="article" />
<meta property="og:site_name" content="Hoora Docs" />
<meta property="og:title" content="${escapeHtml(title)}" />
<meta property="og:description" content="${escapeHtml(description)}" />
<meta property="og:url" content="${escapeHtml(canonical)}" />
<meta property="og:image" content="${escapeHtml(origin)}/app-icon-512.png" />
<meta name="twitter:card" content="summary" />
<meta name="twitter:title" content="${escapeHtml(title)}" />
<meta name="twitter:description" content="${escapeHtml(description)}" />
</head>`,
    );
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store');
  return res.status(200).send(req.method === 'HEAD' ? undefined : html);
}
