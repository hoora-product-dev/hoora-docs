import { serverClient } from "../server/supabase.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });
  try {
    const tenant = process.env.MICROSOFT_TENANT_ID;
    if (!tenant)
      return res
        .status(503)
        .json({ error: "Microsoft sign-in is not configured." });
    const call = serverClient();
    if (!req.headers.authorization?.startsWith("Bearer "))
      return res.status(401).json({ error: "Please sign in with Microsoft." });
    const user = await call("/auth/v1/user", {
      headers: { Authorization: req.headers.authorization },
    });
    const identity = user.identities?.find((i) => i.provider === "azure");
    const { providerToken } =
      typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    if (
      !identity ||
      typeof providerToken !== "string" ||
      providerToken.length > 20000
    )
      return res
        .status(403)
        .json({ error: "A verified Microsoft work account is required." });
    // A Graph request validates the Microsoft access token's signature and audience.
    // Never trust user-editable Supabase metadata to assign team membership or roles.
    const graphHeaders = { Authorization: `Bearer ${providerToken}` };
    const [profileResponse, subjectResponse] = await Promise.all([
      fetch(
        "https://graph.microsoft.com/v1.0/me?$select=id,displayName,userPrincipalName,userType",
        { headers: graphHeaders, signal: AbortSignal.timeout(10000) },
      ),
      fetch("https://graph.microsoft.com/oidc/userinfo", {
        headers: graphHeaders,
        signal: AbortSignal.timeout(10000),
      }),
    ]);
    if (!profileResponse.ok || !subjectResponse.ok)
      return res.status(403).json({
        error: "Microsoft could not verify your account. Sign in again.",
      });
    const profile = await profileResponse.json(),
      subject = await subjectResponse.json();
    let claims;
    try {
      claims = JSON.parse(
        Buffer.from(providerToken.split(".")[1], "base64url").toString(),
      );
    } catch {
      return res.status(403).json({ error: "Invalid Microsoft token." });
    }
    const expectedSubject =
      identity.identity_data?.sub ||
      identity.identity_data?.provider_id ||
      identity.id;
    if (
      claims.tid !== tenant ||
      profile.userType !== "Member" ||
      subject.sub !== expectedSubject
    ) {
      return res.status(403).json({
        error:
          "Only Hoora employee accounts can access this workspace. Guest and personal accounts are not enabled.",
      });
    }
    const blocked = await call(
      `/rest/v1/docs_sso_blocks?microsoft_subject=eq.${encodeURIComponent(subject.sub)}&select=microsoft_subject`,
    );
    if (blocked.length)
      return res.status(403).json({
        error:
          "Your access has been removed. Contact a Hoora Docs administrator.",
      });
    let members = await call(`/rest/v1/docs_members?id=eq.${user.id}&select=*`);
    if (members.length && !members[0].active)
      return res.status(403).json({
        error: "Your account is disabled. Contact a Hoora Docs administrator.",
      });
    const attributes = {
      auth_source: "microsoft",
      microsoft_subject: subject.sub,
    };
    if (members[0]?.auth_source === "password")
      attributes.password_setup_complete = false;
    if (!members.length) {
      await call("/rest/v1/docs_members", {
        method: "POST",
        headers: { Prefer: "resolution=ignore-duplicates" },
        body: JSON.stringify({
          id: user.id,
          email: user.email,
          name: profile.displayName || user.email,
          role: "viewer",
          password_setup_complete: false,
          ...attributes,
        }),
      });
    } else {
      await call(`/rest/v1/docs_members?id=eq.${user.id}`, {
        method: "PATCH",
        body: JSON.stringify(attributes),
      });
    }
    members = await call(
      `/rest/v1/docs_members?id=eq.${user.id}&select=role,active`,
    );
    return res
      .status(200)
      .json({ ok: true, role: members[0]?.role || "viewer" });
  } catch (error) {
    return res.status(error.status === 401 ? 401 : 400).json({
      error: error.message || "Unable to complete Microsoft sign-in.",
    });
  }
}
