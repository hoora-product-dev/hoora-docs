import { serverClient, requireMember } from "../server/supabase.js";
import { announcement, TEST_RECIPIENT } from "../server/email.js";
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });
  try {
    const call = serverClient(),
      { member } = await requireMember(req, call);
    if (member.role !== 'admin')
      return res.status(403).json({ error: "Only administrators can preview or send email announcements." });
    const b =
      typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    if (!/^[a-f0-9-]{36}$/i.test(b.id || ""))
      throw new Error("Invalid document.");
    const [page] = await call(`/rest/v1/docs_published?id=eq.${b.id}&select=*`);
    if (!page)
      throw new Error("Publish the document before preparing an announcement.");
    const email = announcement(page, member);
    const ready = member.auth_source === "microsoft";
    if (b.action === "preview")
      return res
        .status(200)
        .json({ ...email, to: TEST_RECIPIENT, mode: "test", ready });
    if (b.action !== "send-test") throw new Error("Invalid action.");
    if (b.to || b.cc || b.bcc)
      throw new Error("Recipients cannot be changed during testing.");
    if (typeof b.providerToken !== "string" || b.providerToken.length > 20000)
      throw new Error("Connect Outlook to send this test email.");
    if (!/^[a-f0-9-]{36}$/i.test(b.requestId || ""))
      throw new Error("Invalid send request.");
    const graphHeaders = { Authorization: "Bearer " + b.providerToken };
    const identityResponse = await fetch(
      "https://graph.microsoft.com/oidc/userinfo",
      { headers: graphHeaders, signal: AbortSignal.timeout(10000) },
    );
    const graphIdentity = await identityResponse.json();
    if (
      !identityResponse.ok ||
      !member.microsoft_subject ||
      graphIdentity.sub !== member.microsoft_subject
    )
      throw new Error(
        "Connect the same Microsoft account you use for Hoora Docs.",
      );
    const claims = JSON.parse(
      Buffer.from(b.providerToken.split(".")[1], "base64url").toString(),
    );
    if (
      claims.tid !== process.env.MICROSOFT_TENANT_ID ||
      !claims.scp?.split(" ").includes("Mail.Send")
    )
      throw new Error(
        "Outlook mail permission has not been granted. Connect Outlook again.",
      );
    await call("/rest/v1/docs_mail_tests", {
      method: "POST",
      body: JSON.stringify({
        id: b.requestId,
        actor_id: member.id,
        page_id: page.id,
      }),
    });
    const result = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
      method: "POST",
      headers: { ...graphHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          subject: email.subject,
          body: { contentType: "HTML", content: email.html },
          toRecipients: [{ emailAddress: { address: TEST_RECIPIENT } }],
        },
        saveToSentItems: true,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!result.ok) {
      const error = await result.json().catch(() => null);
      throw new Error(
        error?.error?.message || "Outlook could not send the test email.",
      );
    }
    await call("/rest/v1/docs_mail_tests?id=eq." + b.requestId, {
      method: "PATCH",
      body: JSON.stringify({ status: "accepted" }),
    });
    return res
      .status(200)
      .json({ ok: true, to: TEST_RECIPIENT, provider: "outlook" });
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message });
  }
}
