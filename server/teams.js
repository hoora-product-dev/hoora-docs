import { releaseFacts } from './email.js';

/**
 * Release announcements in Microsoft Teams: one Adaptive Card per person, in a one-to-one
 * chat. The card says what the release email says, laid out the Teams way so it follows each
 * person's light, dark or high-contrast theme.
 */

// Teams fetches the card's images and opens its links itself, so they always point at the
// live site, even when the card is prepared on a local copy of Hoora Docs.
const SITE = 'https://release.hoora.in';
export const SENDER = 'Hoora Releases';
// The Power Automate test flow posts to this one person only.
export const FLOW_RECIPIENT = 'rahul@hoora.me';
// Who signs the Teams card ("From the desk of …"). Rahul always comes first when he is on a
// release. Customer App and Hoora on Web are always signed by Rahul and Deepkumar (spelled as
// in the Microsoft directory); every release also lists whoever published it and wrote it.
const RAHUL = { name: 'Rahul Tripathi', email: 'rahul@hoora.me' };
const DEEPKUMAR = { name: 'Deepkumar Mahajan', email: 'deep@hoora.me' };
const ALWAYS_SIGNED = /customer|hoora on web/i;
const teamsChat = (email, message) =>
  `https://teams.microsoft.com/l/chat/0/0?users=${encodeURIComponent(email)}` +
  (message ? `&message=${encodeURIComponent(message)}` : '');
// Names as people expect to read them: single spaces ("Rahul  Tripathi" → "Rahul Tripathi").
const tidy = (name) =>
  String(name || '')
    .replace(/\s+/g, ' ')
    .trim();
const same = (a, b) =>
  (a.email && b.email && a.email.toLowerCase() === b.email.toLowerCase()) ||
  tidy(a.name).toLowerCase() === tidy(b.name).toLowerCase();
// A name inside the card's Markdown: no characters that would turn it into a link or style.
const plain = (name) => tidy(String(name).replace(/[[\]()*_`\\]/g, ''));

/**
 * The people who sign a release's Teams card, first person first. writers: the publisher,
 * then the writer of each part of the release, as [{ name, email }].
 */
export function releaseSigners(page, writers = []) {
  const people = writers.filter((person) => person?.name?.trim());
  const signers = [];
  const add = (person) => {
    if (!signers.some((signer) => same(signer, person))) signers.push(person);
  };
  if (ALWAYS_SIGNED.test(page.release_snapshot?.project || '')) [RAHUL, DEEPKUMAR].forEach(add);
  else if (people.some((person) => same(person, RAHUL))) add(RAHUL);
  people.forEach(add);
  return signers;
}

const text = (value, extra = {}) => ({ type: 'TextBlock', text: value, wrap: true, ...extra });
const column = (width, items, extra = {}) => ({ type: 'Column', width, items, ...extra });
const columns = (list, extra = {}) => ({ type: 'ColumnSet', columns: list, ...extra });
const link = (title, url, extra = {}) => ({ type: 'Action.OpenUrl', title, url, ...extra });

/**
 * The Adaptive Card for one release, with the same facts as the release email.
 * signers: from releaseSigners. Issues and feedback go to the first of them.
 */
export function teamsCard(page, highlights, signers = releaseSigners(page)) {
  const facts = releaseFacts(page, SITE, highlights);
  const { store, author } = facts;
  const release = `${facts.platform} ${facts.version}`.replace(/\s+/g, ' ').trim();
  const lead = signers.find((person) => person.email) || RAHUL;
  // Rahul's name opens his profile; every other name opens a Teams chat with that person.
  const signature = signers.map((person) =>
    same(person, RAHUL)
      ? `[${person.name}](${author.url})`
      : person.email
        ? `[${plain(person.name)}](${teamsChat(person.email)})`
        : plain(person.name),
  );
  const body = [
    columns([
      column(
        'auto',
        [
          {
            type: 'Image',
            url: SITE + '/hoora-mark.png',
            altText: 'Hoora',
            width: '28px',
            height: '28px',
            style: 'Person',
          },
        ],
        { verticalContentAlignment: 'Center' },
      ),
      column('stretch', [text('Hoora', { weight: 'Bolder' })], {
        verticalContentAlignment: 'Center',
      }),
      column('auto', [text('● Now live', { color: 'Good', weight: 'Bolder', size: 'Small' })], {
        verticalContentAlignment: 'Center',
      }),
    ]),
    text(facts.platform, { isSubtle: true, spacing: 'Large' }),
    columns(
      [
        column('stretch', [
          text(facts.version || page.title, { size: 'ExtraLarge', weight: 'Bolder' }),
        ]),
        ...(facts.released
          ? [
              column('auto', [text(facts.released, { isSubtle: true, size: 'Small' })], {
                verticalContentAlignment: 'Bottom',
              }),
            ]
          : []),
      ],
      { spacing: 'None' },
    ),
  ];
  if (facts.points.length) {
    body.push(
      text('What’s new', {
        weight: 'Bolder',
        size: 'Small',
        isSubtle: true,
        spacing: 'Large',
        separator: true,
      }),
      ...facts.points.map((point) =>
        columns(
          [
            column('auto', [text('✓', { color: 'Good', weight: 'Bolder' })]),
            column('stretch', [
              text(point.text),
              text(point.area, { isSubtle: true, size: 'Small', spacing: 'None' }),
            ]),
          ],
          { spacing: 'Medium' },
        ),
      ),
    );
  }
  body.push({
    type: 'ActionSet',
    spacing: 'Large',
    actions: [
      link(facts.notesLabel, facts.url, { style: 'positive' }),
      link('Install Hoora Docs', facts.install),
    ],
  });
  // The store badges from the email, each opening its store listing.
  if (store) {
    const badge = (url, image, width, altText) =>
      column(
        'auto',
        [
          {
            type: 'Image',
            url: SITE + image,
            altText,
            width,
            height: '40px',
            selectAction: { type: 'Action.OpenUrl', title: altText, url },
          },
        ],
        { verticalContentAlignment: 'Center' },
      );
    body.push(
      text(`Update ${store.name}`, {
        size: 'Small',
        weight: 'Bolder',
        isSubtle: true,
        spacing: 'Large',
      }),
      columns(
        [
          store.android &&
            badge(store.android, '/email/google-play.png', '134px', 'Get it on Google Play'),
          store.ios &&
            badge(store.ios, '/email/app-store.png', '120px', 'Download on the App Store'),
        ].filter(Boolean),
        { spacing: 'Small' },
      ),
    );
  }
  body.push(
    {
      type: 'Container',
      style: 'emphasis',
      spacing: 'Large',
      items: [
        columns([
          column('stretch', [text('Issues or feedback? Let us know', { size: 'Small' })], {
            verticalContentAlignment: 'Center',
          }),
          column(
            'auto',
            [
              {
                type: 'ActionSet',
                actions: [link('Chat on Teams', teamsChat(lead.email, `${release}: `))],
              },
            ],
            { verticalContentAlignment: 'Center' },
          ),
        ]),
      ],
    },
    text('Shipped by the **Product & Tech teams**', {
      size: 'Small',
      isSubtle: true,
      spacing: 'Medium',
    }),
  );
  // The sign-off: one centred line naming the signers. (The email keeps its own sign-off.)
  if (signature.length)
    body.push(
      text(`${facts.signOff} ${signature.join(', ')}`, {
        size: 'Small',
        isSubtle: true,
        horizontalAlignment: 'Center',
        spacing: 'Large',
        separator: true,
      }),
    );
  return {
    type: 'AdaptiveCard',
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    // 1.4 renders the same in Teams on the desktop, the web and phones.
    version: '1.4',
    msteams: { width: 'Full' },
    // What Teams shows in a notification, and where a card cannot be drawn.
    fallbackText: `${facts.platform} ${facts.version} is now live: ${facts.url}`,
    body,
  };
}

/** The message a Teams webhook (a Workflows flow) expects: one Adaptive Card attachment. */
export function teamsPayload(card) {
  return {
    type: 'message',
    attachments: [
      { contentType: 'application/vnd.microsoft.card.adaptive', contentUrl: null, content: card },
    ],
  };
}

const esc = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const safeUrl = (url) => (/^(https:|mailto:)/i.test(String(url)) ? String(url) : '#');

// The little Markdown a card's text uses: **bold** and [links](url). The text is escaped
// first, so a link's address is already safe inside the attribute.
const markdown = (value) =>
  esc(value)
    .replace(
      /\[([^\]]+)\]\(([^)\s]+)\)/g,
      (_, label, url) => `<a href="${safeUrl(url)}">${label}</a>`,
    )
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

const SPACING = { None: 0, Small: 4, Default: 8, Medium: 12, Large: 20 };
const SIZE = { Small: 12, Default: 14, Medium: 16, Large: 20, ExtraLarge: 28 };

function element(item, first, origin) {
  const gap = first ? 0 : (SPACING[item.spacing] ?? SPACING.Default);
  const top = `margin-top:${gap}px;${item.separator && !first ? 'border-top:1px solid var(--line);padding-top:' + gap + 'px;' : ''}`;
  if (item.type === 'TextBlock') {
    const classes = [
      item.isSubtle && 'subtle',
      item.color === 'Good' && 'good',
      item.color === 'Attention' && 'attention',
      item.weight === 'Bolder' && 'bold',
    ]
      .filter(Boolean)
      .join(' ');
    const size = SIZE[item.size] || SIZE.Default;
    const align = item.horizontalAlignment === 'Center' ? 'text-align:center;' : '';
    return `<div class="text ${classes}" style="${top}${align}font-size:${size}px;line-height:${Math.round(size * 1.4)}px">${markdown(item.text)}</div>`;
  }
  if (item.type === 'Image') {
    // On a local copy, the card's own images come from that copy, so the preview shows them
    // before they are live.
    const image = `<img src="${esc(origin && item.url.startsWith(SITE + '/') ? origin + item.url.slice(SITE.length) : safeUrl(item.url))}" alt="${esc(item.altText)}" style="${top}width:${esc(item.width)};height:${esc(item.height)};${item.style === 'Person' ? 'border-radius:50%;object-fit:cover;' : ''}display:block">`;
    // An image with a selectAction is a link, like a store badge.
    return item.selectAction
      ? `<a href="${esc(safeUrl(item.selectAction.url))}">${image}</a>`
      : image;
  }
  if (item.type === 'ColumnSet') {
    // A row with a selectAction is one link, like the whole row in Teams.
    const tag = item.selectAction ? 'a' : 'div';
    const href = item.selectAction ? ` href="${esc(safeUrl(item.selectAction.url))}"` : '';
    return `<${tag} class="columns${item.selectAction ? ' select' : ''}"${href} style="${top}">${item.columns
      .map(
        (col) =>
          `<div class="column" style="flex:${col.width === 'stretch' ? '1 1 0' : '0 0 auto'};align-self:${{ Center: 'center', Bottom: 'flex-end' }[col.verticalContentAlignment] || 'flex-start'}">${col.items.map((child, i) => element(child, i === 0, origin)).join('')}</div>`,
      )
      .join('')}</${tag}>`;
  }
  if (item.type === 'Container')
    return `<div class="container ${item.style === 'emphasis' ? 'emphasis' : ''}" style="${top}">${item.items.map((child, i) => element(child, i === 0, origin)).join('')}</div>`;
  if (item.type === 'ActionSet')
    return `<div class="actions" style="${top}">${item.actions
      .map(
        (action) =>
          `<a class="action ${action.style === 'positive' ? 'positive' : ''}" href="${esc(safeUrl(action.url))}">${esc(action.title)}</a>`,
      )
      .join('')}</div>`;
  return '';
}

/**
 * A preview of the card as a Teams chat message from Hoora Releases, for the Announce page.
 * It draws only what teamsCard uses, in the Teams look, in light and dark.
 */
export function teamsPreview(card, origin = SITE) {
  const message = card.body.map((item, i) => element(item, i === 0, origin)).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><base target="_blank"><title>Teams message preview</title><style>
:root{--page:#f5f5f5;--card:#ffffff;--ink:#242424;--subtle:#616161;--good:#0e700e;--line:#e0e0e0;--emphasis:#f5f5f5;--button:#ffffff;--button-line:#d1d1d1;--brand:#5b5fc7}
@media (prefers-color-scheme:dark){:root{--page:#1f1f1f;--card:#292929;--ink:#ffffff;--subtle:#adadad;--good:#54b054;--line:#3d3d3d;--emphasis:#1f1f1f;--button:#292929;--button-line:#666666;--brand:#7f85f5}}
*{box-sizing:border-box}
html{overflow:hidden}
body{margin:0;padding:20px 16px;background:var(--page);color:var(--ink);font:14px/20px 'Segoe UI',-apple-system,BlinkMacSystemFont,Roboto,Helvetica,Arial,sans-serif}
.message{display:flex;gap:10px;max-width:680px}
.avatar{width:32px;height:32px;border-radius:50%;flex:0 0 32px}
.meta{font-size:12px;color:var(--subtle);margin:0 0 4px}
.meta b{color:var(--ink);font-weight:600;margin-right:8px}
.card{background:var(--card);border:1px solid var(--line);border-radius:6px;padding:16px;flex:1;min-width:0}
.text{overflow-wrap:anywhere}
.subtle{color:var(--subtle)}.good{color:var(--good)}.attention{color:#c4314b}.bold{font-weight:600}
.columns{display:flex;gap:10px}
.select{color:inherit;text-decoration:none}
.column{min-width:0}
.container{margin-left:-16px;margin-right:-16px;padding:10px 16px}
.emphasis{background:var(--emphasis)}
.actions{display:flex;flex-wrap:wrap;gap:8px}
.action{display:inline-block;padding:5px 12px;border:1px solid var(--button-line);border-radius:4px;background:var(--button);color:var(--ink);font-weight:600;text-decoration:none}
.action.positive{background:var(--brand);border-color:var(--brand);color:#fff}
a{color:var(--brand)}
</style></head><body><div class="message"><img class="avatar" src="${SITE}/hoora-mark.png" alt=""><div style="flex:1;min-width:0"><p class="meta"><b>${esc(SENDER)}</b>now</p><div class="card">${message}</div></div></div></body></html>`;
}
