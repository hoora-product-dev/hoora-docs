const SITE = 'https://hooratechteam.atlassian.net';
const CLOUD_ID = 'fa2b39bd-d6de-43e4-8a70-d40ce1bd145f';
export const VERTICAL_FIELD = 'customfield_11075';
export const OWNER_FIELD = 'customfield_10433';
export const jiraConfigured = () =>
  Boolean(process.env.JIRA_READ_EMAIL && process.env.JIRA_READ_API_TOKEN);
export const failure = (message, status = 400) =>
  Object.assign(new Error(message), { status, public: true });

export function filterIdFromUrl(value) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    throw failure('Paste a valid Jira saved-filter link.');
  }
  if (
    url.origin !== SITE ||
    url.username ||
    url.password ||
    url.hash ||
    !/^\/(issues|issues\/|secure\/IssueNavigator\.jspa)$/.test(url.pathname)
  )
    throw failure('Use a saved-filter link from hooratechteam.atlassian.net.');
  const id = url.searchParams.get('filter');
  if (!/^[1-9]\d{0,15}$/.test(id || '') || url.searchParams.has('jql'))
    throw failure('The link must contain a saved filter, not a JQL query.');
  return id;
}

export async function jiraRequest(path, body) {
  if (!jiraConfigured())
    throw failure(
      'Jira connection is not configured. Ask an administrator to complete setup.',
      503,
    );
  // The host, REST paths, fields and JQL are generated here. Never forward a client URL or query.
  const base = `https://api.atlassian.com/ex/jira/${CLOUD_ID}/rest/api/3`;
  const response = await fetch(base + path, {
    method: body ? 'POST' : 'GET',
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
    headers: {
      Authorization:
        'Basic ' +
        Buffer.from(process.env.JIRA_READ_EMAIL + ':' + process.env.JIRA_READ_API_TOKEN).toString(
          'base64',
        ),
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    if (response.status === 429) throw failure('Jira is busy. Please try again in a moment.', 429);
    if ([401, 403].includes(response.status))
      throw failure(
        'Jira connection needs attention. Ask an administrator to check the read-only token and filter access.',
        503,
      );
    if (response.status === 404)
      throw failure('The saved Jira filter is unavailable to the integration.', 422);
    throw failure('Jira could not load these tickets. Please try again.', 502);
  }
  return response.json();
}

export function fieldValues(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value.flatMap(fieldValues);
  if (typeof value === 'string') return [{ id: value.slice(0, 200), label: value.slice(0, 200) }];
  const label = value.displayName || value.value || value.name;
  return label
    ? [
        {
          id: String(value.accountId || value.id || label).slice(0, 200),
          label: String(label).slice(0, 200),
        },
      ]
    : [];
}

export function ticketSummary(issue) {
  const f = issue.fields || {};
  return {
    key: issue.key,
    title: String(f.summary || '').slice(0, 500),
    status: f.status?.name || '',
    type: f.issuetype?.name || '',
    verticals: fieldValues(f[VERTICAL_FIELD]),
    owners: fieldValues(f[OWNER_FIELD]),
    updatedAt: f.updated || null,
  };
}

export async function searchTickets(filterId, issueKey = null) {
  if (!/^[1-9]\d{0,15}$/.test(String(filterId))) throw failure('Invalid saved filter.');
  if (issueKey && !/^[A-Z][A-Z0-9_]{0,30}-[1-9]\d{0,12}$/.test(issueKey))
    throw failure('Invalid ticket.');
  const fields = ['summary', 'status', 'issuetype', 'updated', VERTICAL_FIELD, OWNER_FIELD];
  if (issueKey)
    fields.push(
      'description',
      'priority',
      'assignee',
      'reporter',
      'created',
      'duedate',
      'labels',
      'fixVersions',
      'project',
    );
  const jql = `filter = ${filterId}${issueKey ? ` AND key = "${issueKey}"` : ''}`;
  const issues = [];
  let nextPageToken;
  for (let page = 0; page < 50; page++) {
    const result = await jiraRequest('/search/jql', {
      jql,
      fields,
      maxResults: issueKey ? 1 : 100,
      ...(nextPageToken ? { nextPageToken } : {}),
    });
    issues.push(...(result.issues || []));
    if (issueKey || result.isLast || !result.nextPageToken) return issues;
    if (result.nextPageToken === nextPageToken)
      throw failure('Jira returned an invalid results page. Please refresh.', 502);
    nextPageToken = result.nextPageToken;
  }
  throw failure(
    'This filter has too many tickets. Narrow the saved Jira filter and try again.',
    422,
  );
}

export function ticketDetail(issue) {
  const f = issue.fields || {};
  return {
    ...ticketSummary(issue),
    description: f.description || null,
    priority: f.priority?.name || '',
    assignee: f.assignee?.displayName || '',
    reporter: f.reporter?.displayName || '',
    createdAt: f.created || null,
    dueDate: f.duedate || null,
    labels: f.labels || [],
    fixVersions: (f.fixVersions || []).map((v) => v.name),
    project: f.project?.name || '',
  };
}
