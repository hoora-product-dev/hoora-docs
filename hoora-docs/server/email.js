const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export const TEST_RECIPIENT = "rahul@hoora.me";
export function announcement(
  page,
  actor,
  origin = "https://hoora-docs.vercel.app",
) {
  const url = origin + "/#/doc/" + encodeURIComponent(page.slug);
  const groups = new Map();
  for (const entry of page.release_snapshot?.entries || []) {
    const group = groups.get(entry.vertical) || [];
    group.push(entry);
    groups.set(entry.vertical, group);
  }
  const details = [...groups]
    .map(
      ([vertical, entries]) =>
        `<tr><td style="padding:20px 32px 0"><h2 style="font-size:16px;margin:0 0 12px">${esc(vertical)}</h2>${entries.map((entry) => `<p style="font-size:14px;margin:6px 0">• ${esc(entry.title)}</p><p style="color:#666;font-size:12px;margin:0 0 12px">Added by ${esc(entry.author)}</p>`).join("")}</td></tr>`,
    )
    .join("");
  const subject =
    `${page.version ? page.version + " · " : ""}${page.title}`.slice(0, 200);
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f5f5f5;font-family:Arial,sans-serif;color:#171717"><div style="display:none;max-height:0;overflow:hidden">${esc(page.summary || "A new Hoora document is ready to read.")}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:36px 12px"><table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border:1px solid #e8e8e8;border-radius:12px"><tr><td style="padding:28px 32px;border-bottom:1px solid #eee"><img src="${origin}/hoora-logo.png" alt="Hoora" width="92" style="vertical-align:middle"><span style="font-size:18px;vertical-align:middle;margin-left:12px">Docs</span></td></tr><tr><td style="padding:32px 32px 0"><span style="font-size:11px;font-weight:bold;letter-spacing:1px;color:#666">${page.kind === "release" ? "RELEASE NOTES" : "KNOWLEDGE UPDATE"}</span><h1 style="font-size:28px;line-height:1.25;margin:12px 0 16px">${esc(page.title)}</h1><p style="font-size:15px;line-height:1.7;color:#555">${esc(page.summary || "The latest published document is ready for your review.")}</p><p style="font-size:12px;color:#777">Published ${new Date(page.published_at).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}</p></td></tr>${details}<tr><td style="padding:28px 32px 32px"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td bgcolor="#ffda00" style="border-radius:6px"><a href="${esc(url)}" style="display:inline-block;padding:14px 22px;color:#151515;font-size:14px;font-weight:bold;text-decoration:none">Read the ${page.kind === "release" ? "release notes" : "document"} →</a></td></tr></table><p style="font-size:12px;color:#777;margin-top:24px">Shared by ${esc(actor.name || actor.email)} via Hoora Docs.</p></td></tr><tr><td style="padding:24px 32px;background:#fafafa;border-top:1px solid #eee;font-size:12px;line-height:1.8;color:#777"><a href="${esc(url)}" style="color:#555">Open this document</a><br>Hoora Technologies · Hoora Docs<br><span style="font-size:11px">Workspace maintained by Rahul Tripathi</span></td></tr></table><p style="font-size:11px;color:#999">Test preview · Delivery is restricted to ${TEST_RECIPIENT}</p></td></tr></table></body></html>`;
  return {
    subject,
    html,
    text: `${page.title}\n\n${page.summary}\n\nRead: ${url}\n\nShared by ${actor.name || actor.email} via Hoora Docs.\nWorkspace maintained by Rahul Tripathi`,
  };
}
