import { serverClient, requireMember } from '../server/supabase.js';
import { announcement, highlightSections } from '../server/email.js';
import { releaseHighlights } from '../server/highlights.js';
import {
  releaseSigners,
  teamsCard,
  teamsPayload,
  teamsPreview,
  SENDER,
  FLOW_RECIPIENT,
} from '../server/teams.js';
import { botReady, cardMessage, sendToChat, teamsEndpoint } from '../server/teams-bot.js';

export const maxDuration = 60;

// A Power Automate flow that posts the card as the Workflows bot, to Rahul only: a way to see
// the card in Teams on a local copy, before the Hoora Releases bot is in Teams. Its address
// works like a password, so it lives only in the server's environment.
const teamsHook = () => {
  const hook = process.env.TEAMS_WORKFLOW_URL || '';
  return /^https:\/\/[^/]+\.(logic\.azure\.com|powerplatform\.com)(:\d+)?\//.test(hook) ? hook : '';
};
// How Teams messages go out: from the Hoora Releases bot, or through the test flow when a
// local copy is set to TEAMS_DELIVERY=workflow (or has no bot).
const teamsMode = () => {
  if (process.env.TEAMS_DELIVERY === 'workflow' && teamsHook()) return 'flow';
  if (botReady()) return 'bot';
  return teamsHook() ? 'flow' : null;
};
const TEST_LIMIT = 10;
const DAY = 24 * 3600e3;

// Administrators and managers of the Product Team send releases on Teams.
async function canSendTeams(call, member) {
  if (member.role === 'admin') return true;
  return (
    (await call('/rest/v1/rpc/docs_can_send_teams', {
      method: 'POST',
      body: JSON.stringify({ member: member.id }),
    })) === true
  );
}

// Who published the release and who wrote each part of it, with their work email from their
// Hoora Docs account: [{ name, email }], publisher first. Someone without an account keeps
// their name only.
async function releaseWriters(call, page) {
  const names = [
    ...new Set(
      (page.release_snapshot?.entries || [])
        .map((entry) => String(entry.author || '').trim())
        .filter(Boolean),
    ),
  ];
  const quoted = names.map((name) => `"${name.replace(/["\\]/g, '\\$&')}"`).join(',');
  const members = [
    ...(page.published_by
      ? await call(
          `/rest/v1/docs_members?id=eq.${encodeURIComponent(page.published_by)}&select=id,name,email`,
        )
      : []),
    ...(names.length
      ? await call(
          `/rest/v1/docs_members?name=in.(${encodeURIComponent(quoted)})&select=id,name,email`,
        )
      : []),
  ];
  const person = (member, name) => ({
    name: member?.name || name,
    email: member?.email ? String(member.email).toLowerCase() : undefined,
  });
  const publisher = members.find((member) => member.id === page.published_by);
  return [
    ...(publisher || page.published_by_name ? [person(publisher, page.published_by_name)] : []),
    ...names.map((name) =>
      person(
        members.find((member) => member.name?.trim().toLowerCase() === name.toLowerCase()),
        name,
      ),
    ),
  ].filter((writer) => writer.name);
}

// Everyone who has Hoora Releases in Teams: their one-to-one chats with the bot.
const activeChats = (call) =>
  call('/rest/v1/docs_teams_chats?removed_at=is.null&select=email,conversation_id,service_url');

// Sends the card from Hoora Releases into each chat, eight at a time. Teams may ask to slow
// down; each message is then tried once more.
async function sendFromBot(chats, card, summary) {
  const sent = [],
    failed = [];
  const deliver = (chat) =>
    sendToChat(chat, cardMessage(card, summary)).catch(async (error) => {
      if (error.status !== 429) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2000));
      return sendToChat(chat, cardMessage(card, summary));
    });
  for (let i = 0; i < chats.length; i += 8)
    await Promise.all(
      chats.slice(i, i + 8).map((chat) =>
        deliver(chat).then(
          () => sent.push(chat.email),
          (error) => {
            console.error('Teams send failed:', chat.email, error.message);
            failed.push(chat.email);
          },
        ),
      ),
    );
  if (!sent.length) throw new Error('Teams did not accept the message.');
  return { sent, failed };
}

// The test flow: posts the card as the Workflows bot, to Rahul only.
async function sendFromFlow(card) {
  const sent = await fetch(teamsHook(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(teamsPayload(card)),
    signal: AbortSignal.timeout(20000),
  });
  if (!sent.ok) throw new Error(`Teams did not accept the message (${sent.status}).`);
  return { sent: [FLOW_RECIPIENT], failed: [] };
}

// The last successful send of a release to everyone, while it still blocks another one.
// If it cannot be read, the button still shows; the send itself is always checked.
async function lastTeamsSend(call, id) {
  const [row] = await call(
    `/rest/v1/docs_teams_sends?page_id=eq.${id}&select=sent_at,sent_by_name`,
  ).catch(() => []);
  if (!row?.sent_at) return null;
  const next = new Date(new Date(row.sent_at).getTime() + DAY);
  return next > new Date()
    ? { at: row.sent_at, by: row.sent_by_name, next: next.toISOString() }
    : null;
}

// What the Teams buttons need: where messages go, and what is still allowed.
async function teamsStatus(call, member, page) {
  const mode = teamsMode();
  const [chats, tests] = await Promise.all([
    mode === 'bot' ? activeChats(call).catch(() => []) : [],
    call(
      `/rest/v1/docs_teams_tests?member_id=eq.${member.id}&sent_at=gt.${new Date(Date.now() - DAY).toISOString()}&select=id`,
    ).catch(() => []),
  ]);
  return {
    allowed: true,
    ready: Boolean(mode),
    sender: mode === 'flow' ? 'Workflows (test flow)' : SENDER,
    // Who "Send on Teams" reaches: everyone with Hoora Releases, or Rahul through the flow.
    everyone: mode === 'bot' ? { people: chats.length } : { only: FLOW_RECIPIENT },
    tests: { used: tests.length, limit: TEST_LIMIT },
    last: await lastTeamsSend(call, page.id),
  };
}

// "4:30 pm, 28 Nov" in India time.
const when = (value) =>
  value
    ? new Date(value).toLocaleString('en-IN', {
        hour: 'numeric',
        minute: '2-digit',
        day: 'numeric',
        month: 'short',
        timeZone: 'Asia/Kolkata',
      })
    : 'recently';
const tooSoon = (message) => Object.assign(new Error(message), { status: 429 });

// A test card says so at the top: it went to the sender only.
const testCard = (card) => ({
  ...card,
  body: [
    {
      type: 'TextBlock',
      text: 'Test message: only you received this.',
      size: 'Small',
      color: 'Attention',
      wrap: true,
    },
    ...card.body,
  ],
});

// Release announcements, for administrators and Product Team managers. The email is never
// sent from here: the page shows it to copy into Outlook. The Teams message is sent from here:
// as a test to the sender (10 a day each), or to everyone (once a day per release).
export default async function handler(req, res) {
  // Teams calling the Hoora Releases bot (/api/teams, routed here by vercel.json).
  if (req.query?.source === 'teams') return teamsEndpoint(req, res, serverClient);
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const call = serverClient(),
      { member } = await requireMember(req, call);
    const b = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    if (!(await canSendTeams(call, member))) {
      // The release page asks quietly; the answer only hides the buttons.
      if (b.action === 'teams-status') return res.status(200).json({ allowed: false });
      return res.status(403).json({
        error: 'Only administrators and Product Team managers can announce releases.',
      });
    }
    if (!['preview', 'teams-send', 'teams-test', 'teams-status'].includes(b.action))
      throw new Error('Invalid action.');
    if (!/^[a-f0-9-]{36}$/i.test(b.id || '')) throw new Error('Invalid release.');
    const [page] = await call(`/rest/v1/docs_published?id=eq.${b.id}&select=*`);
    if (!page || page.kind !== 'release')
      throw new Error('Choose a published release to announce.');
    if (b.action === 'teams-status')
      return res.status(200).json(await teamsStatus(call, member, page));
    // Local previews point images and links at the local site; everything else uses production.
    const host = String(req.headers?.host || '');
    const origin = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)
      ? 'http://' + host
      : 'https://release.hoora.in';
    // Short written highlights, cached per published version of the release.
    const highlights = await releaseHighlights(
      `${page.id}:${page.updated_at || page.published_at || ''}`,
      highlightSections(page),
    );
    const email = announcement(page, origin, highlights);
    const card = teamsCard(
      page,
      highlights,
      releaseSigners(page, await releaseWriters(call, page)),
    );
    const mode = teamsMode();
    if ((b.action === 'teams-test' || b.action === 'teams-send') && !mode)
      throw new Error('Teams sending is not set up yet.');

    if (b.action === 'teams-test') {
      // The card to the sender's own chat, up to 10 times in 24 hours.
      const mine = String(member.email || '').toLowerCase();
      const chats =
        mode === 'bot'
          ? (await activeChats(call)).filter((chat) => String(chat.email).toLowerCase() === mine)
          : [];
      if (mode === 'bot' && !chats.length)
        throw new Error('Add Hoora Releases in Teams first. Test messages go to your own chat.');
      const claim = await call('/rest/v1/rpc/docs_teams_test_claim', {
        method: 'POST',
        body: JSON.stringify({ member: member.id, target: page.id }),
      });
      if (!claim?.ok)
        throw tooSoon(
          `You have used your ${TEST_LIMIT} test messages for today. You can test again after ${when(claim?.next_at)}.`,
        );
      try {
        const result =
          mode === 'bot'
            ? await sendFromBot(chats, testCard(card), `Test: ${email.subject}`)
            : await sendFromFlow(testCard(card));
        return res.status(200).json({ ...result, used: claim.used, limit: TEST_LIMIT });
      } catch (error) {
        // A test that did not reach Teams does not count.
        await call(`/rest/v1/docs_teams_tests?id=eq.${claim.id}`, { method: 'DELETE' }).catch(
          () => {},
        );
        throw error;
      }
    }

    if (b.action === 'teams-send') {
      const chats = mode === 'bot' ? await activeChats(call) : [];
      if (mode === 'bot' && !chats.length)
        throw new Error('Nobody has Hoora Releases in Teams yet.');
      // One successful send per release per 24 hours, whoever presses the button: claim the
      // send first, so two people pressing at once cannot both send.
      const claim = await call('/rest/v1/rpc/docs_teams_claim', {
        method: 'POST',
        body: JSON.stringify({ target: page.id }),
      });
      if (!claim?.ok)
        throw tooSoon(
          claim?.sending
            ? 'This release is being sent on Teams right now.'
            : `Already sent on Teams${claim?.sent_by_name ? ' by ' + claim.sent_by_name.replace(/\s+/g, ' ') : ''} at ${when(claim?.sent_at)}. It can be sent again after ${when(claim?.next_at)}.`,
        );
      const sendings = `/rest/v1/docs_teams_sends?page_id=eq.${page.id}`;
      try {
        const result =
          mode === 'bot' ? await sendFromBot(chats, card, email.subject) : await sendFromFlow(card);
        await call(sendings, {
          method: 'PATCH',
          body: JSON.stringify({
            sent_at: new Date().toISOString(),
            sent_by: member.id,
            sent_by_name: member.name || member.email || null,
            sending_since: null,
          }),
        });
        return res.status(200).json(result);
      } catch (error) {
        // Nothing reached Teams: release the claim, so it can be tried again.
        await call(sendings, {
          method: 'PATCH',
          body: JSON.stringify({ sending_since: null }),
        }).catch(() => {});
        throw error;
      }
    }

    return res.status(200).json({
      ...email,
      teams: { ...(await teamsStatus(call, member, page)), preview: teamsPreview(card, origin) },
    });
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message });
  }
}
