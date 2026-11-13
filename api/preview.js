import { readFile } from 'node:fs/promises';
import { createElement as h } from 'react';
import { ImageResponse } from '@vercel/og';
import { serverClient } from '../server/supabase.js';

// Shared links (Teams, WhatsApp, Slack, email) read the page's Open Graph tags and
// image. This endpoint serves the app shell with tags for the exact link, and draws
// the matching preview image. Previews show the platform, version and outline only;
// note content stays behind sign-in, and restricted documents stay anonymous.

const slugShape = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const versionShape = /^\d+(?:\.\d+){0,3}(?:-[a-z0-9.-]+)?$/i;
const site = 'Hoora Docs';
const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character],
  );
const one = (value) => String(Array.isArray(value) ? value[0] : value || '');
const clip = (text, length) => {
  const value = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  return value.length > length ? value.slice(0, length - 1).trimEnd() + '…' : value;
};
const day = (value) =>
  value
    ? new Intl.DateTimeFormat('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'Asia/Kolkata',
      }).format(new Date(value))
    : '';
const list = (items) =>
  items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items.at(-1)}` : items[0] || '';
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const stamp = (value) => (value ? Math.floor(new Date(value).getTime() / 1000).toString(36) : '0');

const homeCard = {
  image: { kind: 'home' },
  eyebrow: 'Hoora Docs',
  title: 'Release notes, SOPs and team documentation',
  meta: 'Sign in with your Hoora Microsoft account',
  pageTitle: 'Hoora Docs',
  description:
    'Release notes, SOPs and team documentation for Hoora. Sign in with your Hoora Microsoft account.',
};

/** Changes in a release note are numbered third-level headings. */
export function countChanges(body) {
  return (String(body || '').match(/^###\s+\d+\./gm) || []).length;
}

export function releaseCard({ platform, version, publishedAt, entries = [] }) {
  const sections = entries.filter((entry) => String(entry.body || '').trim());
  const verticals = [
    ...new Set(sections.map((entry) => String(entry.vertical || '').trim())),
  ].filter(Boolean);
  const changes = sections.reduce((sum, entry) => sum + countChanges(entry.body), 0);
  const facts = [
    publishedAt ? `Released ${day(publishedAt)}` : 'Not published yet',
    changes ? plural(changes, 'change') : '',
  ].filter(Boolean);
  return {
    eyebrow: `Release notes · ${platform}`,
    headline: `v${version}`,
    meta: facts.join(' · '),
    chips: verticals,
    pageTitle: `${platform} v${version} · Release notes`,
    description: `${facts.join(' · ')}${verticals.length ? ` across ${list(verticals)}` : ''}. Sign in to Hoora Docs to read the full notes.`,
  };
}

async function describe(call, target) {
  const { type, slug, version, application } = target;
  if (type === 'release' && slugShape.test(application) && versionShape.test(version)) {
    const [project] = await call(
      `/rest/v1/docs_projects?slug=eq.${application}&select=name&limit=1`,
    );
    if (!project) return homeCard;
    const [page] = await call(
      `/rest/v1/docs_published?kind=eq.release&version=eq.${encodeURIComponent(version)}&release_snapshot->>project=eq.${encodeURIComponent(project.name)}&select=id,published_at,updated_at,release_snapshot&limit=1`,
    );
    const live = Boolean(page);
    return {
      ...releaseCard({
        platform: project.name,
        version,
        publishedAt: live ? page.published_at : null,
        entries: live ? page.release_snapshot?.entries : [],
      }),
      path: `/release-notes/${version}/${application}`,
      image: { kind: 'release', version, application, v: stamp(live && page.updated_at) },
    };
  }
  if ((type === 'doc' || type === 'artifact') && slugShape.test(slug)) {
    const path = `/${type === 'artifact' ? 'artifact' : 'docs'}/${slug}`;
    const [page] = await call(
      `/rest/v1/docs_published?slug=eq.${slug}&select=id,title,summary,kind,visibility,team_id,published_at,updated_at,version,release_snapshot&limit=1`,
    );
    if (!page) return homeCard;
    if (page.kind === 'release' && page.release_snapshot?.project)
      return {
        ...releaseCard({
          platform: page.release_snapshot.project,
          version: String(page.version || page.release_snapshot.version || '').replace(/^v/i, ''),
          publishedAt: page.published_at,
          entries: page.release_snapshot.entries,
        }),
        path,
        image: { kind: type, slug, v: stamp(page.updated_at) },
      };
    // Only documents shared with the whole organization show their title.
    if (page.visibility !== 'private')
      return {
        eyebrow: 'Shared document',
        title: 'A document was shared with you',
        meta: 'Restricted access · Sign in with your Hoora account to open it',
        pageTitle: 'Shared document · Hoora Docs',
        description: 'This document is restricted. Sign in with your Hoora account to open it.',
        path,
        image: { kind: type, slug, v: stamp(page.updated_at) },
      };
    const [[docType], [team]] = await Promise.all([
      call(`/rest/v1/docs_types?key=eq.${encodeURIComponent(page.kind)}&select=name&limit=1`),
      page.team_id
        ? call(`/rest/v1/docs_teams?id=eq.${page.team_id}&select=name&limit=1`)
        : Promise.resolve([]),
    ]);
    const label =
      [docType?.name?.replace(/^([A-Z]{2,})s$/, '$1'), team?.name].filter(Boolean).join(' · ') ||
      'Document';
    return {
      eyebrow: label,
      title: clip(page.title, 90),
      summary: clip(page.summary, 150),
      meta: `Updated ${day(page.updated_at || page.published_at)}`,
      pageTitle: `${clip(page.title, 70)} · Hoora Docs`,
      description: clip(`${label}. ${page.summary || ''}`, 200),
      path,
      image: { kind: type, slug, v: stamp(page.updated_at) },
    };
  }
  if (type === 'upcoming' && slugShape.test(slug)) {
    const [release] = await call(
      `/rest/v1/docs_upcoming_releases?slug=eq.${slug}&select=title,version,release_date,enabled,updated_at&limit=1`,
    );
    if (!release) return homeCard;
    const image = { kind: 'upcoming', slug, v: stamp(release.updated_at) };
    const path = `/upcoming/${slug}`;
    if (!release.enabled)
      return {
        eyebrow: 'Upcoming release',
        title: 'An upcoming release was shared with you',
        meta: 'Sign in with your Hoora account to view it',
        pageTitle: 'Upcoming release · Hoora Docs',
        description: 'Sign in with your Hoora account to view this upcoming release.',
        path,
        image,
      };
    const planned = release.release_date
      ? `Planned for ${day(release.release_date)}`
      : 'Date to be confirmed';
    return {
      eyebrow: 'Upcoming release',
      headline: release.version ? `v${release.version}` : clip(release.title, 40),
      meta: `${planned} · Tickets from Jira`,
      pageTitle: `${release.title} · Upcoming release`,
      description: `${planned}. See the tickets in this release on Hoora Docs.`,
      path,
      image,
    };
  }
  if (type === 'page') return pageCard(call, target);
  return homeCard;
}

// Main pages: fixed wording, except Release notes, which shows the latest release.
const pages = {
  upcoming: {
    eyebrow: 'Upcoming releases',
    title: 'What ships next across Hoora',
    meta: 'Planned releases and their Jira tickets',
    path: '/upcoming',
  },
  install: {
    eyebrow: 'Install Hoora Docs',
    title: 'Release notes and SOPs, one tap away',
    meta: 'iPhone, Android and desktop · Alerts when updates ship',
    path: '/install',
  },
  library: {
    eyebrow: 'Library',
    title: 'SOPs and team documentation',
    meta: 'Sign in with your Hoora account to browse',
    path: '/browse',
  },
};

async function pageCard(call, { page, project }) {
  if (page === 'releases') {
    const [projects, releases] = await Promise.all([
      call('/rest/v1/docs_projects?select=name,slug&order=name'),
      call(
        '/rest/v1/docs_published?kind=eq.release&select=id,version,published_at,updated_at,project:release_snapshot->>project&order=published_at.desc&limit=200',
      ),
    ]);
    const platform = slugShape.test(project) ? projects.find((p) => p.slug === project) : null;
    const shown = releases.filter((release) => !platform || release.project === platform.name);
    const latest = shown[0];
    const image = { kind: 'page', page, project: platform?.slug, v: stamp(latest?.updated_at) };
    if (platform)
      return {
        eyebrow: `Release notes · ${platform.name}`,
        headline: latest ? `v${latest.version}` : platform.name,
        meta: latest
          ? `Latest release · ${day(latest.published_at)} · ${plural(shown.length, 'version')}`
          : 'No releases published yet',
        pageTitle: `${platform.name} release notes · Hoora Docs`,
        description: latest
          ? `Latest: ${platform.name} v${latest.version}, released ${day(latest.published_at)}. Every version and what changed.`
          : `Release notes for ${platform.name}.`,
        path: `/releases?project=${platform.slug}`,
        image,
      };
    return {
      eyebrow: 'Release notes',
      title: 'What’s new across Hoora',
      meta: latest
        ? `Latest: ${latest.project} v${latest.version} · ${day(latest.published_at)}`
        : 'Every platform, every version',
      chips: projects.map((p) => p.name),
      pageTitle: 'Release notes · Hoora Docs',
      description: `Release notes for ${list(projects.map((p) => p.name))}.${latest ? ` Latest: ${latest.project} v${latest.version}.` : ''}`,
      path: '/releases',
      image,
    };
  }
  const card = pages[page];
  if (!card) return homeCard;
  return {
    ...card,
    pageTitle: `${card.eyebrow} · Hoora Docs`,
    description: `${card.title}. ${card.meta}.`,
    image: { kind: 'page', page },
  };
}

function imageUrl(origin, image) {
  // `d` is the card design; raising it gives every link a fresh image after a redesign.
  const params = new URLSearchParams({ image: image.kind, d: '2' });
  for (const key of ['version', 'application', 'slug', 'page', 'project', 'v'])
    if (image[key]) params.set(key, image[key]);
  return `${origin}/api/preview?${params}`;
}

let assets;
async function loadAssets() {
  assets ||= Promise.all([
    readFile(new URL('../public/loader/plus-jakarta-sans-500.ttf', import.meta.url)),
    readFile(new URL('../public/loader/plus-jakarta-sans-700.ttf', import.meta.url)),
    readFile(new URL('../public/loader/plus-jakarta-sans-800.ttf', import.meta.url)),
    readFile(new URL('../public/hoora-mark.png', import.meta.url)),
  ]).then(([medium, bold, extra, mark]) => ({
    fonts: [
      { name: 'Jakarta', data: medium, weight: 500, style: 'normal' },
      { name: 'Jakarta', data: bold, weight: 700, style: 'normal' },
      { name: 'Jakarta', data: extra, weight: 800, style: 'normal' },
    ],
    mark: `data:image/png;base64,${mark.toString('base64')}`,
  }));
  return assets;
}

const ink = '#F5F5F4';
const muted = '#A8A29E';
const yellow = '#FFD60A';

/** The 1200 × 630 preview image: brand, what it is, and a few facts. */
export function cardElement(card, mark, path) {
  const titleSize = card.headline
    ? card.headline.length > 12
      ? 104
      : 132
    : card.title.length > 60
      ? 52
      : card.title.length > 30
        ? 60
        : 72;
  // Documents show their summary in the body, so their date moves to the footer.
  const footer = card.chips?.length ? null : card.summary ? card.meta : path;
  return h(
    'div',
    {
      style: {
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '64px 72px 56px',
        fontFamily: 'Jakarta',
        color: ink,
        backgroundColor: '#0C0C0C',
      },
    },
    h(
      'div',
      { style: { display: 'flex', alignItems: 'center', gap: 18 } },
      h('img', { src: mark, width: 60, height: 60, style: { borderRadius: 30 } }),
      h('div', { style: { fontSize: 30, fontWeight: 700, letterSpacing: -0.4 } }, site),
    ),
    h(
      'div',
      { style: { display: 'flex', flexDirection: 'column', gap: 16 } },
      h('div', { style: { fontSize: 28, fontWeight: 700, color: yellow } }, card.eyebrow),
      h(
        'div',
        {
          style: {
            fontSize: titleSize,
            fontWeight: 800,
            lineHeight: 1.05,
            letterSpacing: card.headline ? -4 : -1.5,
            maxWidth: 1040,
          },
        },
        card.headline || card.title,
      ),
      card.summary
        ? h(
            'div',
            {
              style: {
                fontSize: 28,
                fontWeight: 500,
                color: muted,
                lineHeight: 1.45,
                maxWidth: 1000,
              },
            },
            card.summary,
          )
        : null,
      card.meta && !card.summary
        ? h('div', { style: { fontSize: 30, fontWeight: 500, color: muted } }, card.meta)
        : null,
    ),
    h(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 24,
          paddingTop: 28,
          borderTop: '1px solid #292524',
        },
      },
      h(
        'div',
        { style: { display: 'flex', gap: 10, maxWidth: 960 } },
        ...(card.chips || []).slice(0, 4).map((chip) =>
          h(
            'div',
            {
              key: chip,
              style: {
                display: 'flex',
                padding: '6px 16px',
                borderRadius: 999,
                border: '1.5px solid #3A3532',
                fontSize: 20,
                fontWeight: 500,
                color: '#E7E5E4',
              },
            },
            chip,
          ),
        ),
        footer
          ? h('div', { style: { fontSize: 22, fontWeight: 500, color: muted } }, footer)
          : null,
      ),
      h('div', { style: { fontSize: 22, fontWeight: 700, color: muted } }, 'hoora.in'),
    ),
  );
}

function pageHtml(html, card, origin, canonical) {
  const image = imageUrl(origin, card.image);
  const description = clip(card.description, 200);
  const alt = [card.eyebrow, card.headline || card.title].filter(Boolean).join(' — ');
  const tags = [
    `<meta name="description" content="${escapeHtml(description)}" />`,
    `<link rel="canonical" href="${escapeHtml(canonical)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${site}" />`,
    `<meta property="og:title" content="${escapeHtml(card.pageTitle)}" />`,
    `<meta property="og:description" content="${escapeHtml(description)}" />`,
    `<meta property="og:url" content="${escapeHtml(canonical)}" />`,
    `<meta property="og:image" content="${escapeHtml(image)}" />`,
    `<meta property="og:image:secure_url" content="${escapeHtml(image)}" />`,
    `<meta property="og:image:type" content="image/png" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="${escapeHtml(alt)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeHtml(card.pageTitle)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(description)}" />`,
    `<meta name="twitter:image" content="${escapeHtml(image)}" />`,
  ].join('\n    ');
  return html
    .replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(card.pageTitle)}</title>`)
    .replace(
      /<!-- social -->[\s\S]*?<!-- \/social -->/,
      `<!-- social -->\n    ${tags}\n    <!-- /social -->`,
    );
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(405).end();
  const query = (key) => one(req.query?.[key]);
  const imageKind = query('image');
  const target = {
    type: imageKind || query('type'),
    slug: query('slug').toLowerCase(),
    version: query('version').replace(/^v/i, ''),
    application: query('application').toLowerCase(),
    page: query('page'),
    project: query('project').toLowerCase(),
  };
  let card = homeCard;
  try {
    card = await describe(serverClient(), target);
  } catch {
    card = homeCard;
  }
  const origin = `https://${req.headers['x-forwarded-host'] || req.headers.host}`;
  const path = card.path || '/';

  if (imageKind) {
    const { fonts, mark } = await loadAssets();
    const image = new ImageResponse(
      cardElement(card, mark, `release.hoora.in${path === '/' ? '' : path}`),
      {
        width: 1200,
        height: 630,
        fonts,
      },
    );
    const png = Buffer.from(await image.arrayBuffer());
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Length', png.length);
    // The image URL carries the document's last update, so a changed note gets a new URL.
    res.setHeader(
      'Cache-Control',
      'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400',
    );
    return res.status(200).send(req.method === 'HEAD' ? undefined : png);
  }

  let html;
  try {
    html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
  } catch {
    return res.status(503).send('Hoora Docs is temporarily unavailable.');
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=600');
  const body = pageHtml(html, card, origin, origin + path);
  return res.status(200).send(req.method === 'HEAD' ? undefined : body);
}
