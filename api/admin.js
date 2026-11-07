import { serverKeyHeaders } from '../server/supabase.js';
const allowedRoles = ["admin", "manager", "publisher", "viewer"];
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!["GET", "POST"].includes(req.method))
    return res.status(405).json({ error: "Method not allowed" });
  const url = process.env.SUPABASE_URL,
    key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    return res.status(503).json({
      error: "User management is not configured. Contact your administrator.",
    });
  const token = req.headers.authorization;
  if (!token?.startsWith("Bearer "))
    return res.status(401).json({ error: "Please sign in." });
  const call = async (route, options = {}) => {
    const r = await fetch(url + route, {
      ...options,
      headers: {
        ...serverKeyHeaders(key),
        "Content-Type": "application/json",
        ...options.headers,
      },
    });
    const data = await r.json().catch(() => null);
    if (!r.ok)
      throw Object.assign(
        new Error(
          data?.msg ||
            data?.message ||
            data?.error_description ||
            "Request failed",
        ),
        { status: r.status },
      );
    return data;
  };
  try {
    const identity = await call("/auth/v1/user", {
      headers: { Authorization: token },
    });
    const members = await call(
      `/rest/v1/docs_members?id=eq.${identity.id}&select=role,active,auth_source,password_setup_complete`,
    );
    if (members[0]?.role !== "admin" || !members[0]?.active)
      return res.status(403).json({ error: "Administrator access required." });
    if (!members[0].password_setup_complete)
      return res.status(403).json({ error: "Complete password setup first." });
    if (req.method === "GET")
      return res
        .status(200)
        .json(
          await call("/rest/v1/docs_members?select=*&order=created_at.asc"),
        );
    const b = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    if (!b || !["create", "update", "delete", "password"].includes(b.action))
      return res.status(400).json({ error: "Invalid action" });
    if (b.action === "create") {
      b.email=String(b.email||'').trim().toLowerCase();
      if (
        !/^[^\s@]+@hoora\.me$/.test(b.email || "") ||
        (b.password || "").length < 12 ||
        !allowedRoles.includes(b.role)
      )
        return res.status(400).json({
          error:
            "Enter a Hoora work email, a password of at least 12 characters, and a valid role.",
        });
      const user = await call("/auth/v1/admin/users", {
        method: "POST",
        body: JSON.stringify({
          email: b.email,
          password: b.password,
          email_confirm: true,
          user_metadata: { name: String(b.name || "").slice(0, 100) },
        }),
      });
      try {
        await call("/rest/v1/docs_members", {
          method: "POST",
          body: JSON.stringify({
            id: user.id,
            email: b.email,
            name: String(b.name || "").slice(0, 100),
            role: b.role,
          }),
        });
        await call(
          "/rest/v1/docs_sso_blocks?email=eq." + encodeURIComponent(b.email),
          { method: "DELETE" },
        );
      } catch (e) {
        await call(`/auth/v1/admin/users/${user.id}`, { method: "DELETE" });
        throw e;
      }
      return res.status(201).json({ ok: true });
    }
    if (!/^[0-9a-f-]{36}$/i.test(b.id || ""))
      return res.status(400).json({ error: "Invalid member" });
    if (
      b.id === identity.id &&
      (b.action === "delete" ||
        b.active === false ||
        (b.role && b.role !== "admin"))
    )
      return res.status(400).json({
        error: "Ask another administrator to change your own access.",
      });
    if (b.action === "update") {
      if (!allowedRoles.includes(b.role) || typeof b.active !== "boolean")
        return res
          .status(400)
          .json({ error: "Invalid role or account status" });
      await call(`/rest/v1/docs_members?id=eq.${b.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          role: b.role,
          active: b.active,
          name: String(b.name || "").slice(0, 100),
        }),
      });
    } else if (b.action === "password") {
      if ((b.password || "").length < 12)
        return res.status(400).json({ error: "Use at least 12 characters." });
      await call(`/auth/v1/admin/users/${b.id}`, {
        method: "PUT",
        body: JSON.stringify({ password: b.password }),
      });
    } else {
      // The database protects the last administrator. Remove membership first so access stops immediately.
      const removed = await call(
        `/rest/v1/docs_members?id=eq.${b.id}&select=email,microsoft_subject`,
      );
      await call(`/rest/v1/docs_members?id=eq.${b.id}`, { method: "DELETE" });
      if (removed[0]?.microsoft_subject)
        await call("/rest/v1/docs_sso_blocks", {
          method: "POST",
          headers: { Prefer: "resolution=merge-duplicates" },
          body: JSON.stringify({
            microsoft_subject: removed[0].microsoft_subject,
            email: removed[0].email,
          }),
        });
      await call(`/auth/v1/admin/users/${b.id}`, { method: "DELETE" });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res
      .status(e.status === 401 ? 401 : 400)
      .json({ error: e.message || "Unable to complete this action." });
  }
}
