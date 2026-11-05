export function serverKeyHeaders(key) {
  return {
    apikey: key,
    ...(!key.startsWith('sb_secret_') ? { Authorization: `Bearer ${key}` } : {}),
  };
}
export function serverClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw Object.assign(new Error("Server configuration is incomplete."), {
      status: 503,
    });
  return async (path, options = {}) => {
    const response = await fetch(url + path, {
      ...options,
      signal: AbortSignal.timeout(15000),
      headers: {
        ...serverKeyHeaders(key),
        "Content-Type": "application/json",
        ...options.headers,
      },
    });
    const data = await response.json().catch(() => null);
    if (!response.ok)
      throw Object.assign(
        new Error(
          data?.message || data?.msg || "Unable to complete the request.",
        ),
        { status: response.status },
      );
    return data;
  };
}
export async function requireMember(req, call) {
  if (!req.headers.authorization?.startsWith("Bearer "))
    throw Object.assign(new Error("Please sign in."), { status: 401 });
  const user = await call("/auth/v1/user", {
    headers: { Authorization: req.headers.authorization },
  });
  const members = await call(`/rest/v1/docs_members?id=eq.${user.id}&select=*`);
  if (!members[0]?.active)
    throw Object.assign(
      new Error("Your team access is disabled or has not been granted."),
      { status: 403 },
    );
  if (!members[0].password_setup_complete)
    throw Object.assign(new Error("Complete your password setup first."), {
      status: 403,
    });
  return { user, member: members[0] };
}
