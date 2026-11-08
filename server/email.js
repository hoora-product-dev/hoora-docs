import { publishedPath } from './links.js';
const esc = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const SHOWN_PER_SECTION = 5;
const FONT = "font-family:Arial,'Helvetica Neue',Helvetica,sans-serif";

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

/**
 * Release announcement email. Built from tables and inline styles only, so it renders
 * in Outlook and survives being copied from Hoora Docs and pasted into a new message.
 */
export function announcement(page, actor, origin = 'https://hoora-docs.vercel.app') {
  const url = origin + publishedPath(page);
  const platform = page.release_snapshot?.project || '';
  const version = page.version ? 'v' + String(page.version).replace(/^v/i, '') : '';
  const heading = platform && version ? `${platform} ${version}` : page.title;
  const sections = (page.release_snapshot?.entries || [])
    .map((entry) => ({
      name: entry.vertical || entry.title || 'Updates',
      items: changeTitles(entry.body),
    }))
    .filter((section) => section.items.length);
  const total = sections.reduce((sum, section) => sum + section.items.length, 0);
  const released = page.published_at
    ? new Date(page.published_at).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'Asia/Kolkata',
      })
    : '';
  const facts = [
    released && `Released ${released}`,
    total && `${total} change${total === 1 ? '' : 's'}`,
  ]
    .filter(Boolean)
    .join(' · ');
  const details = sections
    .map((section) => {
      const shown = section.items.slice(0, SHOWN_PER_SECTION);
      const more = section.items.length - shown.length;
      return `<tr><td style="padding:22px 32px 0;${FONT}"><p style="margin:0 0 10px;font-size:15px;font-weight:bold;color:#171717">${esc(section.name)} <span style="font-weight:normal;color:#8a8a8a">· ${section.items.length}</span></p>${shown
        .map(
          (item) =>
            `<p style="margin:0 0 8px;font-size:14px;line-height:1.5;color:#333">&bull;&nbsp; ${esc(item)}</p>`,
        )
        .join(
          '',
        )}${more ? `<p style="margin:0;font-size:13px;color:#8a8a8a">+ ${more} more in the release notes</p>` : ''}</td></tr>`;
    })
    .join('');
  const summary =
    page.summary && !/^\d+ changes? across /i.test(page.summary)
      ? `<p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#444">${esc(page.summary)}</p>`
      : '';
  const subject = `${heading} is live · Release notes`.slice(0, 200);
  const sender = actor?.name || actor?.email || 'the Hoora product team';
  const body = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4"><tr><td align="center" style="padding:32px 12px"><table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid #e6e6e6;border-radius:12px"><tr><td style="padding:24px 32px;border-bottom:1px solid #eeeeee;${FONT}"><img src="${origin}/hoora-light.png" alt="Hoora" width="88" style="vertical-align:middle;border:0"><span style="font-size:17px;color:#555;vertical-align:middle;margin-left:10px">Docs</span></td></tr><tr><td style="padding:30px 32px 0;${FONT}"><p style="margin:0;font-size:11px;font-weight:bold;letter-spacing:1px;color:#777">RELEASE NOTES</p><h1 style="margin:10px 0 8px;font-size:26px;line-height:1.25;color:#171717">${esc(heading)} is live</h1>${facts ? `<p style="margin:0 0 14px;font-size:13px;color:#777">${esc(facts)}</p>` : ''}${summary}</td></tr>${details}<tr><td style="padding:28px 32px 8px;${FONT}"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td bgcolor="#ffda00" style="border-radius:6px"><a href="${esc(url)}" style="display:inline-block;padding:13px 22px;color:#151515;font-size:14px;font-weight:bold;text-decoration:none;${FONT}">Read the release notes &rarr;</a></td></tr></table></td></tr><tr><td style="padding:8px 32px 30px;${FONT}"><p style="margin:0;font-size:13px;line-height:1.6;color:#666">Get alerts for every release: <a href="${origin}/install" style="color:#171717;font-weight:bold">install the Hoora Docs app</a></p></td></tr><tr><td style="padding:20px 32px;background:#fafafa;border-top:1px solid #eeeeee;border-radius:0 0 12px 12px;font-size:12px;line-height:1.7;color:#888;${FONT}">Shared by ${esc(sender)} via Hoora Docs<br>Hoora Technologies &middot; <a href="${origin}" style="color:#888">hoora-docs.vercel.app</a><br><span style="font-size:11px">Workspace maintained by Rahul Tripathi</span></td></tr></table></td></tr></table>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head><body style="margin:0;background:#f4f4f4">${body}</body></html>`;
  const text = [
    `${heading} is live`,
    facts,
    '',
    ...sections.flatMap((section) => [
      `${section.name} (${section.items.length})`,
      ...section.items.slice(0, SHOWN_PER_SECTION).map((item) => `- ${item}`),
      ...(section.items.length > SHOWN_PER_SECTION
        ? [`+ ${section.items.length - SHOWN_PER_SECTION} more in the release notes`]
        : []),
      '',
    ]),
    `Read the release notes: ${url}`,
    `Install the Hoora Docs app: ${origin}/install`,
    '',
    `Shared by ${sender} via Hoora Docs`,
  ]
    .filter((line, index, all) => line !== '' || all[index - 1] !== '')
    .join('\n');
  return { subject, html, body, text, url };
}
