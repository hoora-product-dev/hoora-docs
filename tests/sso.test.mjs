import test from "node:test";
import assert from "node:assert/strict";
import handler from "../api/sso.js";
const tenant = "e990c26c-1489-4803-b7f2-dc1cf4cac0bf";
const response = () => ({
  setHeader() {},
  status(c) {
    this.code = c;
    return this;
  },
  json(d) {
    this.data = d;
  },
});
test("SSO denies unauthenticated requests and user-editable metadata", async () => {
  process.env.MICROSOFT_TENANT_ID = tenant;
  process.env.SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "server";
  let res = response();
  await handler({ method: "POST", headers: {}, body: {} }, res);
  assert.equal(res.code, 401);
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        id: "u",
        user_metadata: { provider: "azure", role: "admin" },
      }),
    );
  try {
    res = response();
    await handler(
      {
        method: "POST",
        headers: { authorization: "Bearer supabase-token" },
        body: { providerToken: "fake" },
      },
      res,
    );
    assert.equal(res.code, 403);
  } finally {
    globalThis.fetch = original;
  }
});
test("SSO provisions a verified employee as viewer, never from metadata roles", async () => {
  const original = globalThis.fetch;
  let created = null,
    memberReads = 0;
  globalThis.fetch = async (url, options = {}) => {
    let body;
    if (url.endsWith("/auth/v1/user"))
      body = {
        id: "u",
        email: "employee@hoora.me",
        user_metadata: { role: "admin" },
        identities: [{ provider: "azure", identity_data: { sub: "subject" } }],
      };
    else if (url.includes("/v1.0/me"))
      body = { userType: "Member", displayName: "Employee", userPrincipalName: "employee@hoora.me" };
    else if (url.includes("/oidc/userinfo")) body = { sub: "subject" };
    else if (url.includes("docs_sso_blocks")) body = [];
    else if (url.includes("docs_bootstrap_admins")) body = [];
    else if (options.method === "POST") {
      created = JSON.parse(options.body);
      body = null;
    } else body = memberReads++ ? [{ role: "viewer", active: true }] : [];
    return new Response(JSON.stringify(body), { status: 200 });
  };
  try {
    const token =
      "x." +
      Buffer.from(JSON.stringify({ tid: tenant })).toString("base64url") +
      ".x";
    const res = response();
    await handler(
      {
        method: "POST",
        headers: { authorization: "Bearer supabase-token" },
        body: { providerToken: token },
      },
      res,
    );
    assert.equal(res.code, 200);
    assert.equal(created.role, "viewer");
    assert.equal(created.microsoft_subject, "subject");
  } finally {
    globalThis.fetch = original;
  }
});
test("SSO rejects guest accounts even when tenant matches", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) =>
    new Response(
      JSON.stringify(
        url.endsWith("/auth/v1/user")
          ? {
              id: "u",
              identities: [
                { provider: "azure", identity_data: { sub: "subject" } },
              ],
            }
          : url.includes("/v1.0/me")
            ? { userType: "Guest" }
            : { sub: "subject" },
      ),
    );
  try {
    const token =
      "x." +
      Buffer.from(JSON.stringify({ tid: tenant })).toString("base64url") +
      ".x";
    const res = response();
    await handler(
      {
        method: "POST",
        headers: { authorization: "Bearer supabase-token" },
        body: { providerToken: token },
      },
      res,
    );
    assert.equal(res.code, 403);
  } finally {
    globalThis.fetch = original;
  }
});
