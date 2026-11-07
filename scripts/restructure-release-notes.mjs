/*
 * Converts the one-entry-per-release GitBook import into a native Hoora Docs
 * changelog. It deliberately keeps only source facts: ticket, title and the
 * original implementation notes. Release boilerplate, duplicated headings,
 * status lines and Jira URLs are represented by the UI instead of copied into
 * every change.
 *
 * Preview: node --env-file=.env scripts/restructure-release-notes.mjs
 * Apply:   node --env-file=.env scripts/restructure-release-notes.mjs --apply
 */
import { loadEnvFile } from 'node:process';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { databaseOptions } from './database-options.mjs';

loadEnvFile();
const apply = process.argv.includes('--apply');
const ticketPattern = /\b([A-Z][A-Z0-9]+-\d+)\b/g;
const jiraTicket = /\[Open in Jira\]\([^)]*\)/gi;

const unique = (items) => [...new Set(items.filter(Boolean))];
const ticketsIn = (value) =>
  unique([...String(value || '').matchAll(ticketPattern)].map((m) => m[1]));
const compact = (value) =>
  String(value || '')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();

const cleanTitle = (value) =>
  String(value || '')
    .replace(/\\(?=\[)/g, '')
    .replace(/^[\s–—:-]+/, '')
    .replace(/^CLONE\s*-\s*/i, '')
    .replace(/\[(?:feature|enhancement|ui update|revamp|bug|backend|documentation)\]\s*/gi, '')
    .replace(/^\s*[-–—]\s*/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

const classify = (title, body) => {
  const text = `${title}\n${body}`.toLowerCase();
  if (
    /wallet|points|coin|coupon|payment|autopay|refer|referral|insurance|rsa|challan|subscription|pms/.test(
      text,
    )
  )
    return 'Value-added Services';
  if (
    /car wash|garage|workshop|repair|service booking|booking|slot|denting|paint|tracking|glass replacement|ev charging/.test(
      text,
    )
  )
    return 'Car Repair & Services';
  if (
    /catalog|product|accessor|vehicle make|vehicle model|cart|checkout|category|brand logo|fitment/.test(
      text,
    )
  )
    return 'Products';
  return 'Auto Care';
};

const summaryTitles = (body) => {
  const titles = new Map();
  for (const row of String(body || '').matchAll(
    /^\|\s*\d+\s*\|\s*\[([A-Z][A-Z0-9]+-\d+)\][^|]*\|\s*([^|]+?)\s*\|/gm,
  ))
    titles.set(row[1], cleanTitle(row[2].replace(/[*_`]/g, '')));
  return titles;
};

const cleanBody = (value) => {
  let body = String(value || '')
    .replace(jiraTicket, '')
    .replace(/\*\*Ticket:\*\*\s*\[[^\]]+\]\([^)]*\)/gi, '')
    .replace(/\*\*Status:\*\*[^\n]*/gi, '')
    .replace(/^\|.*\|\s*$/gm, '')
    .replace(/^\s*\*\*\*(?:\s*)$/gm, '')
    .replace(
      /^\s*#{1,6}\s*(?:✅\s*)?(?:Released|Release Summary|Contributors|Carried Forward)\b.*$/gim,
      '',
    )
    .replace(
      /^\s*(?:Hoora(?:\s+On)?\s+Web|Hoora\s+Customer\s+App|Customer\s+App).*?(?:Released|Sprint|release notes).*$/gim,
      '',
    )
    .replace(/^\s*The following (?:updates|items).*?(?:release|note only).*$/gim, '')
    .replace(/^\s*\*\*(?:What changed|Details|Summary)\*\*\s*$/gim, '')
    .replace(/^\s*\*\*(?:Evidence|Evidence\s*\/\s*References|References?)\b[^\n]*$/gim, '')
    .replace(
      /^\s*[-*]?\s*\*\*(?:Type|Priority|Product Owner|Assignee|QA|FE Developer|BE Developer)\*\*.*$/gim,
      '',
    );
  body = body.replace(/^\s*#{1,6}\s+.*?(?:Carried Forward|Contributors).*$/gim, '');
  return compact(body);
};

function customerChanges(body, summary) {
  const matches = [
    ...String(body || '').matchAll(
      /^#{3,6}\s+(?:[^\w\n]*\s*)?(\d+)\.\s*([A-Z][A-Z0-9]+-\d+)\s*(?:—|-)?\s*(.+?)\s*$/gim,
    ),
  ];
  return matches.map((match, index) => {
    const from = match.index + match[0].length;
    const to = matches[index + 1]?.index ?? body.length;
    const ticket = match[2];
    const text = cleanBody(body.slice(from, to));
    const title = cleanTitle(match[3] || summary.get(ticket) || `Update ${match[1]}`);
    return { ticket, title, body: text };
  });
}

function webChanges(body, summary) {
  const matches = [
    ...String(body || '').matchAll(/^#{3,6}\s+(?:[^\w\n]*\s*)?\d+\.\s+(.+?)\s*$/gim),
  ];
  return matches.map((match, index) => {
    const from = match.index + match[0].length;
    const to = matches[index + 1]?.index ?? body.length;
    const part = body.slice(from, to);
    const ticket = ticketsIn(part)[0] || ticketsIn(match[1])[0] || '';
    const title = cleanTitle(summary.get(ticket) || match[1]);
    return { ticket, title, body: cleanBody(part) };
  });
}

function changesFor(entry) {
  const source = String(entry.body || '');
  const summary = summaryTitles(source);
  const ticketHeadings = customerChanges(source, summary);
  const changes = ticketHeadings.length ? ticketHeadings : webChanges(source, summary);
  return changes
    .filter((change) => change.ticket || change.title)
    .map((change) => ({
      ...change,
      title: change.title || summary.get(change.ticket) || 'Documented change',
      body: change.body || 'Implementation details are recorded in the linked ticket.',
    }));
}

const client = new pg.Client(databaseOptions());
await client.connect();
const q = (text, values = []) => client.query(text, values);
try {
  const { rows: releases } = await q(`
    select page.id, page.title, page.summary, page.body, page.revision, page.updated_at,
           pub.release_snapshot, pub.published_at, pub.source_url,
           project.name as project_name, project.slug as project_slug,
           coalesce(json_agg(json_build_object(
             'id', entry.id, 'title', entry.title, 'body', entry.body, 'tickets', entry.tickets,
             'author_id', entry.author_id, 'author_name', entry.author_name,
             'updated_by', entry.updated_by, 'updated_name', entry.updated_name,
             'created_at', entry.created_at, 'updated_at', entry.updated_at
           ) order by entry.created_at) filter(where entry.id is not null), '[]') as entries
    from public.docs_pages page
    join public.docs_releases release on release.id=page.id
    join public.docs_projects project on project.id=release.project_id
    join public.docs_published pub on pub.id=page.id
    left join public.docs_entries entry on entry.release_id=page.id
    where page.kind='release'
    group by page.id,pub.release_snapshot,pub.published_at,pub.source_url,project.name,project.slug
    order by pub.published_at desc nulls last
  `);
  const { rows: verticals } = await q('select id,name,icon,color from public.docs_verticals');
  const verticalByName = new Map(verticals.map((vertical) => [vertical.name, vertical]));
  const plans = releases.map((release) => {
    const raw = release.entries.length === 1 ? release.entries[0] : null;
    const isRawAggregate =
      raw &&
      (new RegExp(`(?:${release.project_name}|${release.version})`, 'i').test(raw.title) ||
        raw.body.includes('**Status:**'));
    const changes = isRawAggregate
      ? changesFor(raw)
      : raw
        ? [
            {
              ticket: ticketsIn(raw.tickets)[0] || ticketsIn(raw.body)[0] || '',
              title: cleanTitle(raw.title),
              body: compact(raw.body),
            },
          ]
        : release.entries.map((entry) => ({
            ticket: ticketsIn(entry.tickets)[0] || ticketsIn(entry.body)[0] || '',
            title: cleanTitle(entry.title),
            body: compact(entry.body),
          }));
    const author = raw || release.entries[0] || {};
    const entries = changes.map((change, index) => {
      const verticalName = classify(change.title, change.body);
      const vertical = verticalByName.get(verticalName) || verticals[0];
      return {
        id: randomUUID(),
        release_id: release.id,
        vertical_id: vertical.id,
        vertical: vertical.name,
        vertical_icon: vertical.icon || 'grid',
        vertical_color: vertical.color || 'slate',
        title: change.title.slice(0, 200),
        body: change.body.slice(0, 100000),
        tickets: change.ticket || ticketsIn(change.body).join(', '),
        author_id: author.author_id || null,
        author_name: author.author_name || 'Hoora team',
        updated_by: author.updated_by || author.author_id || null,
        updated_name: author.updated_name || author.author_name || 'Hoora team',
        created_at: author.created_at || release.updated_at,
        updated_at: author.updated_at || release.updated_at,
        order: index,
      };
    });
    return { ...release, entries };
  });
  console.log(
    `Prepared ${plans.length} releases and ${plans.reduce((total, plan) => total + plan.entries.length, 0)} structured changes.`,
  );
  for (const plan of plans)
    console.log(
      `${plan.title}: ${plan.entries.length} changes — ${plan.entries
        .slice(0, 3)
        .map((entry) => `${entry.tickets || 'no ticket'} ${entry.title}`)
        .join(' | ')}`,
    );
  if (plans.some((plan) => !plan.entries.length))
    throw Error('A release could not be parsed. No database changes were made.');
  if (!apply) {
    console.log('Dry run only. Re-run with --apply after reviewing this plan.');
    process.exit(0);
  }

  await q('begin');
  // This is an administrator maintenance migration. The normal page guard
  // evaluates auth.uid(), which is intentionally absent on this direct
  // PostgreSQL connection; keep the existing folder/team values untouched.
  await q('alter table public.docs_pages disable trigger user');
  await q('alter table public.docs_entries disable trigger user');
  for (const plan of plans) {
    const snapshot = { ...(plan.release_snapshot || {}) };
    snapshot.project = plan.project_name;
    snapshot.project_slug = plan.project_slug;
    snapshot.entries = plan.entries.map(({ order, ...entry }) => ({
      id: entry.id,
      vertical: entry.vertical,
      vertical_id: entry.vertical_id,
      vertical_icon: entry.vertical_icon,
      vertical_color: entry.vertical_color,
      title: entry.title,
      body: entry.body,
      tickets: entry.tickets,
      author: entry.author_name,
      edited_by: entry.updated_name,
      updated_at: entry.updated_at,
    }));
    const releaseBody = plan.entries
      .map(
        (entry, index) =>
          `## ${index + 1}. ${entry.title}\n\n${entry.body}\n\nTicket: ${entry.tickets}`,
      )
      .join('\n\n');
    const summary = `${plan.entries.length} documented changes, organised by product area.`;
    await q('delete from public.docs_entries where release_id=$1', [plan.id]);
    for (const entry of plan.entries)
      await q(
        `insert into public.docs_entries(id,release_id,vertical_id,title,body,tickets,submitted,author_id,author_name,updated_by,updated_name,created_at,updated_at)
         values($1,$2,$3,$4,$5,$6,true,$7,$8,$9,$10,$11,$12)`,
        [
          entry.id,
          entry.release_id,
          entry.vertical_id,
          entry.title,
          entry.body,
          entry.tickets,
          entry.author_id,
          entry.author_name,
          entry.updated_by,
          entry.updated_name,
          entry.created_at,
          entry.updated_at,
        ],
      );
    const { rows: updatedPages } = await q(
      'update public.docs_pages set body=$1,summary=$2,revision=revision+1,updated_at=now() where id=$3 returning revision',
      [releaseBody, summary, plan.id],
    );
    await q(
      'update public.docs_published set body=$1,summary=$2,release_snapshot=$3,revision=$4 where id=$5',
      [releaseBody, summary, JSON.stringify(snapshot), updatedPages[0].revision, plan.id],
    );
    await q('delete from public.docs_ai_chunks where document_id=$1', [plan.id]);
  }
  await q('alter table public.docs_entries enable trigger user');
  await q('alter table public.docs_pages enable trigger user');
  await q('commit');
  console.log('Reformatted every published release and removed stale assistant chunks.');
} catch (error) {
  try {
    await q('rollback');
    await q('alter table public.docs_entries enable trigger user');
    await q('alter table public.docs_pages enable trigger user');
  } catch {
    /* Connection cleanup follows. */
  }
  throw error;
} finally {
  await client.end();
}
