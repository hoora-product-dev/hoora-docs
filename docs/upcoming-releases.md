# Upcoming releases

An administrator creates a release at `/upcoming` with a name, version, target date, Jira saved-filter link and approved `@hoora.me` viewer emails. A new release is private to administrators until sharing is enabled. Sharing requires a date and a working Jira connection. Administrators can edit or delete releases; deleting a page never edits or deletes Jira tickets. Stable page URLs survive changes to the name, version, date or filter.

Approved viewers sign in through Hoora Docs. The page has Vertical and Product Owner dropdowns, populated from all tickets in the saved filter, including a Not assigned option. Both filters apply together. Clicking a title loads description and ticket metadata. Refresh reads current Jira data; no Jira ticket content is copied to Supabase, public search, the AI index or an offline cache. Jira remains the source of truth.

## Integration setup

Use a dedicated Atlassian account with only the Jira issue access needed by the intended saved filters. Create a scoped token with `read:jira-work`, and store `JIRA_READ_EMAIL` and `JIRA_READ_API_TOKEN` as server-only Vercel environment variables. Scoped tokens use Atlassian's API gateway. The configured site is `hooratechteam.atlassian.net`, cloud ID `fa2b39bd-d6de-43e4-8a70-d40ce1bd145f`. The implementation uses the site's confirmed Vertical (`customfield_11075`) and Product Owner (`customfield_10433`) fields. Redeploy after changing credentials.

A token cannot itself be constrained to a saved filter. Jira account permissions constrain the token; the Hoora Docs backend constrains every title/detail request to the release's configured filter. Filter 12576 was inspected as a reference; its name is `5.12.0_Sprint_Tickets`. No release date or stakeholder emails are inferred from it.

## Access and data boundaries

- Every API request verifies the Supabase identity and current active membership. Administrators require completed account setup, as elsewhere in Hoora Docs.
- Each viewer's verified identity email must be on the selected release's list, and sharing must be enabled. Email and role supplied by a client are ignored.
- Admin-only save/delete actions enforce role checks on the server. Updates use a timestamp comparison to reject conflicting edits.
- Tables have RLS enabled and all browser-role grants revoked. Only the server service role can read or change release configuration. No credentials are stored in those tables.
- URLs accept only numeric saved filters on the approved Jira host. REST host, fields and JQL are generated server-side; clients cannot submit arbitrary Jira queries or destinations.
- Details are queried using `filter = <saved ID> AND key = <validated key>`. A ticket removed from a filter becomes unavailable on its next detail request.
- Viewer responses omit email allowlists and filter configuration. All responses use `private, no-store`; no shared content cache is used.
- Jira descriptions are rendered from Atlassian Document Format through an element allowlist with escaped text. Remote media are not fetched automatically. Comments, changelogs, development metadata and attachment binaries are not exposed.
- A database-backed request limit restricts Jira ticket reads to 60 per member per minute. Jira pagination is handled completely, with a clear error rather than silently partial results for filters above 5,000 tickets.

The production connection uses a read-scoped token named `Hoora Docs Upcoming Releases - Read only`, expiring November 6, 2027. Its secret value is stored as a sensitive production environment variable. Rotate it before expiry. The reference release at `/upcoming/release-5-12-0` remains an administrator-only draft until its target date and viewer emails are set.
