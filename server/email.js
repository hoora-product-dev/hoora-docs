import { publishedPath } from './links.js';

const esc = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

// System fonts render crisply in every mail app and never trigger a font download.
const FONT =
  "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const HIGHLIGHTS = 4;
// Who readers reach about an issue or feedback: everyone by email, or Rahul in a Teams chat.
const FEEDBACK = {
  to: ['rahul@hoora.me', 'deep@hoora.me'],
  cc: ['product@hoora.in', 'jyotindra@hoora.me'],
  teams: 'rahul@hoora.me',
};
// The footer: "From the desk of Rahul Tripathi", the name linked to his profile.
const SIGN_OFF = 'From the desk of';
const AUTHOR = { name: 'Rahul Tripathi', url: 'https://rahul-tripathi.web.app/' };

// Store listings for the apps Hoora ships, matched by platform name.
const STORES = [
  {
    match: /customer/i,
    name: 'the Hoora app',
    android: 'https://play.google.com/store/apps/details?id=com.hoora.hoora_customer',
    ios: 'https://apps.apple.com/in/app/id1622615009',
  },
  {
    match: /partner/i,
    name: 'the Hoora Hero app',
    android: 'https://play.google.com/store/apps/details?id=com.hoora.hoora_partner',
  },
];

/** The change titles in one release section: "### 3. [KEY](link) · Title" → "Title". */
export function changeTitles(body) {
  return String(body || '')
    .split('\n')
    .filter((line) => /^###\s+\d+\./.test(line))
    .map((line) =>
      line
        .replace(/^###\s+\d+\.\s*/, '')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/^[A-Z][A-Z0-9]+-\d+\s*·\s*/, '')
        // Markdown emphasis only; underscores inside names (app_package) stay.
        .replace(/\*\*|`/g, '')
        .replace(/(^|\s)[*_]|[*_](?=\s|$)/g, '$1')
        .trim(),
    )
    .filter(Boolean);
}

/** A release's sections with their change titles, in the published order. */
export function releaseSections(page) {
  return (page.release_snapshot?.entries || [])
    .map((entry) => ({
      name: entry.vertical || entry.title || 'Updates',
      items: changeTitles(entry.body),
    }))
    .filter((section) => section.items.length);
}

/** Without written highlights: one change title per section first. */
function titleHighlights(sections) {
  const picked = [];
  for (let round = 0; picked.length < HIGHLIGHTS; round++) {
    const before = picked.length;
    for (const section of sections)
      if (section.items[round] && picked.length < HIGHLIGHTS)
        picked.push({ area: section.name, text: section.items[round] });
    if (picked.length === before) break;
  }
  return picked;
}

// Buttons are padded table cells. Outlook keeps a cell's color and padding when the email
// is pasted into a message, but redraws a padded link as a second box around the first.
function button(url, label, { fill, edge, ink, name }) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" class="btn"><tr><td align="center" bgcolor="${fill}" class="${name}" style="background-color:${fill};border:1px solid ${edge};border-radius:8px;padding:12px 20px;${FONT}"><a href="${esc(url)}" style="color:${ink};font-size:14px;font-weight:600;line-height:18px;text-decoration:none;${FONT}">${label}</a></td></tr></table>`;
}
const primaryButton = (url, label) =>
  button(url, label, { fill: '#111111', edge: '#111111', ink: '#ffffff', name: 'btn-primary' });
const secondaryButton = (url, label) =>
  button(url, label, { fill: '#ffffff', edge: '#d4d4d4', ink: '#111111', name: 'btn-secondary' });

/**
 * What every release announcement says, by email or in Teams: the release, its date, the
 * highlights, the links and who to contact about an issue or feedback.
 * highlights: optional [{ area, text }] written for this release.
 */
export function releaseFacts(page, origin = 'https://release.hoora.in', highlights) {
  const url = origin + publishedPath(page);
  const install = origin + '/install';
  const platform = page.release_snapshot?.project || 'Hoora';
  const version = page.version ? 'v' + String(page.version).replace(/^v/i, '') : '';
  const sections = releaseSections(page);
  const points = (highlights?.length ? highlights : titleHighlights(sections)).slice(0, HIGHLIGHTS);
  // Each highlight is one change. When the list shows only some of them, the main
  // button counts them all: "View all 40 changes".
  const total = sections.reduce((sum, section) => sum + section.items.length, 0);
  const notesLabel =
    points.length && total > points.length ? `View all ${total} changes` : 'View release notes';
  const released = page.published_at
    ? new Date(page.published_at).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'Asia/Kolkata',
      })
    : '';
  const store = STORES.find((item) => item.match.test(platform));
  // "Issues or feedback?": Email opens a message to everyone with this release as the
  // subject; Teams opens a chat with Rahul with the release typed in.
  const release = `${platform} ${version}`.replace(/\s+/g, ' ').trim();
  const feedbackEmail = `mailto:${FEEDBACK.to.join(',')}?cc=${FEEDBACK.cc.join(',')}&subject=${encodeURIComponent(`${release} - Issue or feedback`)}`;
  const feedbackTeams = `https://teams.microsoft.com/l/chat/0/0?users=${encodeURIComponent(FEEDBACK.teams)}&message=${encodeURIComponent(`${release}: `)}`;
  return {
    url,
    install,
    platform,
    version,
    released,
    points,
    notesLabel,
    store,
    feedbackEmail,
    feedbackTeams,
    feedback: FEEDBACK,
    signOff: SIGN_OFF,
    author: AUTHOR,
  };
}

/**
 * Release announcement email. Tables and inline styles only, so it renders the same in
 * Outlook, Gmail and Apple Mail, and survives being copied into a new Outlook message.
 * Outlook drops the width and height of a pasted <div>, so every sized shape (the live dot,
 * the ticks, the buttons) is a table cell.
 * The <head> styles only add extras: phone sizing, dark mode and a gentle entrance
 * animation where the mail app supports it (Apple Mail, iOS Mail).
 * highlights: optional [{ area, text }] written for this release.
 */
export function announcement(page, origin = 'https://release.hoora.in', highlights) {
  const {
    url,
    install,
    platform,
    version,
    released,
    points,
    notesLabel,
    store,
    feedbackEmail,
    feedbackTeams,
  } = releaseFacts(page, origin, highlights);

  const subject = `${platform} ${version} is now live`.trim();
  const preheader = points.length
    ? `${points
        .slice(0, 2)
        .map((point) => point.text)
        .join(', ')} and more.`
    : `${platform} ${version} has been released.`;

  const pointRows = points
    .map(
      (point, index) =>
        `<tr><td class="rise" style="padding:${index ? '14px' : '0'} 0 0;${FONT}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td width="26" valign="top" style="padding-top:2px"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td class="tick" width="18" height="18" align="center" valign="middle" bgcolor="#f1f1f1" style="width:18px;height:18px;border-radius:9px;background-color:#f1f1f1;color:#111111;font-size:11px;line-height:18px;font-weight:700;text-align:center;${FONT}">&#10003;</td></tr></table></td><td valign="top"><p class="ink" style="margin:0;font-size:15px;line-height:22px;font-weight:500;color:#111111;${FONT}">${esc(point.text)}</p><p class="muted" style="margin:1px 0 0;font-size:12px;line-height:17px;color:#8a8a8a;${FONT}">${esc(point.area)}</p></td></tr></table></td></tr>`,
    )
    .join('');

  // "Issues or feedback? Let us know" with two links, Email and Teams.
  const feedbackLink = (href, label) =>
    `<td valign="middle" style="font-size:13px;line-height:20px;white-space:nowrap;${FONT}"><a href="${esc(href)}" class="ink" style="color:#111111;font-weight:600;text-decoration:none;${FONT}">${label}</a></td>`;
  // A soft strip just before the credits: the question on the left, the two links on the right.
  const feedbackRow = `<tr><td class="pad" style="padding:0 36px 24px;${FONT}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td class="note" bgcolor="#f7f7f8" style="background-color:#f7f7f8;border-radius:12px;padding:12px 16px;${FONT}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td class="muted" valign="middle" style="font-size:13px;line-height:20px;color:#6b6b6b;${FONT}">Issues or feedback? Let us know</td><td align="right" valign="middle" style="padding-left:12px"><table role="presentation" cellpadding="0" cellspacing="0"><tr>${feedbackLink(feedbackEmail, 'Email')}<td class="muted" valign="middle" style="padding:0 10px;font-size:13px;line-height:20px;color:#c4c4c8;${FONT}">|</td>${feedbackLink(feedbackTeams, 'Teams')}</tr></table></td></tr></table></td></tr></table></td></tr>`;

  const badges = store
    ? `<tr><td class="pad line" style="padding:28px 36px 24px;border-top:1px solid #efefef;${FONT}"><p class="muted" style="margin:0 0 14px;font-size:12px;line-height:16px;font-weight:600;color:#737373;letter-spacing:0.2px;${FONT}">Update ${esc(store.name)}</p><table role="presentation" cellpadding="0" cellspacing="0"><tr>${store.android ? `<td style="padding:0 10px 0 0"><a href="${esc(store.android)}" style="text-decoration:none"><img src="${origin}/email/google-play.png" width="134" height="40" alt="Get it on Google Play" style="display:block;border:0;width:134px;height:40px"></a></td>` : ''}${store.ios ? `<td><a href="${esc(store.ios)}" style="text-decoration:none"><img src="${origin}/email/app-store.png" width="120" height="40" alt="Download on the App Store" style="display:block;border:0;width:120px;height:40px"></a></td>` : ''}</tr></table></td></tr>`
    : '';

  const body = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="canvas" style="background:#f3f3f4"><tr><td align="center" style="padding:28px 12px 36px"><table role="presentation" width="560" cellpadding="0" cellspacing="0" class="card" style="width:100%;max-width:560px;background:#ffffff;border:1px solid #e7e7e9;border-radius:14px;border-collapse:separate;overflow:hidden"><tr><td class="hero pad" bgcolor="#0f0f0f" style="background:#0f0f0f;background-image:radial-gradient(120% 140% at 100% 0%,#262626 0%,#0f0f0f 55%);border-radius:13px 13px 0 0;padding:24px 36px 30px;${FONT}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td valign="middle"><img src="${origin}/email/hoora-logo-white.png" width="100" height="27" alt="Hoora" style="display:block;border:0;outline:none;width:100px;height:auto"></td><td align="right" valign="middle"><table role="presentation" cellpadding="0" cellspacing="0" style="border:1px solid #2f2f2f;border-radius:20px;background:#171717"><tr><td valign="middle" style="padding:6px 0 6px 11px"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td class="live" width="7" height="7" bgcolor="#22c55e" style="width:7px;height:7px;border-radius:4px;background-color:#22c55e;font-size:0;line-height:0">&nbsp;</td></tr></table></td><td valign="middle" style="padding:6px 12px 6px 8px;font-size:12px;line-height:14px;font-weight:600;color:#e8e8e8;${FONT}">Now live</td></tr></table></td></tr></table><p class="rise" style="margin:40px 0 2px;font-size:15px;line-height:22px;color:#a8a8a8;${FONT}">${esc(platform)}</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="rise"><tr><td valign="bottom"><h1 class="version" style="margin:0;font-size:42px;line-height:48px;font-weight:700;letter-spacing:-1.2px;color:#ffffff;${FONT}">${esc(version || page.title)}</h1></td>${released ? `<td align="right" valign="bottom" style="padding:0 0 8px 12px;font-size:13px;line-height:18px;color:#8c8c8c;white-space:nowrap;${FONT}">${esc(released)}</td>` : ''}</tr></table></td></tr>${
    points.length
      ? `<tr><td class="pad" style="padding:28px 36px 4px;${FONT}"><p class="muted" style="margin:0 0 14px;font-size:12px;line-height:16px;font-weight:600;color:#737373;letter-spacing:0.2px;${FONT}">What’s new</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${pointRows}</table></td></tr>`
      : ''
  }<tr><td class="pad" style="padding:26px 36px 28px;${FONT}"><table role="presentation" cellpadding="0" cellspacing="0" class="btn-table"><tr><td class="btn-cell" style="padding:0 10px 10px 0">${primaryButton(url, notesLabel)}</td><td class="btn-cell" style="padding:0 0 10px 0">${secondaryButton(install, 'Install Hoora Docs')}</td></tr></table></td></tr>${badges}${feedbackRow}<tr><td class="pad line" style="padding:20px 36px 22px;border-top:1px solid #efefef;${FONT}"><p class="muted" style="margin:0;font-size:13px;line-height:20px;color:#737373;${FONT}">Shipped by the <span class="ink" style="color:#111111;font-weight:600">Product &amp; Tech teams</span></p></td></tr></table><table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px"><tr><td align="center" class="foot" style="padding:20px 24px 0;font-size:11px;line-height:18px;color:#9a9a9a;${FONT}">${esc(SIGN_OFF)} <a href="${AUTHOR.url}" style="color:#9a9a9a;text-decoration:underline">${AUTHOR.name}</a></td></tr></table></td></tr></table>`;

  // The inbox preview line goes only in the sent email; a pasted copy could show it.
  const hidden = `<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:#f3f3f4">${esc(preheader)}${'&#8204;&nbsp;'.repeat(60)}</div>`;

  const html = `<!doctype html><html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:o="urn:schemas-microsoft-com:office:office"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>${esc(subject)}</title><!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]--><style>
body{margin:0;padding:0;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
a{text-decoration:none}
@keyframes rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
@keyframes live{0%{box-shadow:0 0 0 0 rgba(34,197,94,.65)}70%{box-shadow:0 0 0 8px rgba(34,197,94,0)}100%{box-shadow:0 0 0 0 rgba(34,197,94,0)}}
.rise{animation:rise .7s cubic-bezier(.2,.7,.2,1) both}
.version{animation-duration:.9s}
.live{animation:live 2.2s ease-out infinite}
.btn-primary:hover{background:#2a2a2a!important}
.btn-secondary:hover{background:#f5f5f5!important}
@media (prefers-reduced-motion:reduce){.rise,.live{animation:none!important}}
@media (max-width:600px){.pad{padding-left:22px!important;padding-right:22px!important}.hero{padding:22px 22px 26px!important}.version{font-size:36px!important;line-height:42px!important}.btn-table,.btn{width:100%!important}.btn-cell{display:block!important;width:100%!important;padding:0 0 10px 0!important}}
@media (prefers-color-scheme:dark){.canvas{background:#0b0b0b!important}.card{background:#161616!important;border-color:#262626!important}.ink{color:#f2f2f2!important}.muted{color:#9a9a9a!important}.line{border-color:#262626!important}.tick{background:#262626!important;color:#f2f2f2!important}.note{background:#1f1f1f!important}.btn-primary{background:#f2f2f2!important;border-color:#f2f2f2!important}.btn-primary a{color:#111111!important}.btn-secondary{background:#161616!important;border-color:#3a3a3a!important}.btn-secondary a{color:#f2f2f2!important}.foot{color:#777777!important}}
[data-ogsc] .ink{color:#f2f2f2!important}[data-ogsc] .muted{color:#9a9a9a!important}[data-ogsb] .card{background:#161616!important}
</style></head><body style="margin:0;padding:0;background:#f3f3f4">${hidden}${body}</body></html>`;

  const feedbackText = `Issues or feedback? Let us know by email to ${FEEDBACK.to.join(', ')} (cc ${FEEDBACK.cc.join(', ')}) or on Teams: ${feedbackTeams}`;
  const text = [
    `${platform} ${version} is now live`,
    released,
    '',
    ...(points.length
      ? ["What's new", ...points.map((point) => `- ${point.text} (${point.area})`), '']
      : []),
    `${notesLabel}: ${url}`,
    `Install Hoora Docs: ${install}`,
    ...(store
      ? [
          '',
          `Update ${store.name}:`,
          ...(store.android ? [`Google Play: ${store.android}`] : []),
          ...(store.ios ? [`App Store: ${store.ios}`] : []),
        ]
      : []),
    '',
    feedbackText,
    '',
    'Shipped by the Product & Tech teams',
    '',
    `${SIGN_OFF} ${AUTHOR.name}`,
  ]
    .filter((line, index, all) => line !== '' || all[index - 1] !== '')
    .join('\n');

  return { subject, preheader, html, body, text, url };
}
