import test from "node:test";
import assert from "node:assert/strict";
import handler from "../api/admin.js";
test("Microsoft administrators must complete password setup before accessing admin tools", async () => {
  process.env.SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "server";
  const original = globalThis.fetch;
  globalThis.fetch = async (url) =>
    new Response(
      JSON.stringify(
        url.endsWith("/auth/v1/user")
          ? { id: "123" }
          : [{ role: "admin", active: true, auth_source: "microsoft" }],
      ),
    );
  const token =
    "x." +
    Buffer.from(JSON.stringify({ amr: [{ method: "password" }] })).toString(
      "base64url",
    ) +
    ".x";
  const res = {
    setHeader() {},
    status(c) {
      this.code = c;
      return this;
    },
    json(d) {
      this.data = d;
    },
  };
  try {
    await handler(
      { method: "GET", headers: { authorization: "Bearer " + token } },
      res,
    );
    assert.equal(res.code, 403);
    assert.match(res.data.error, /password setup/);
  } finally {
    globalThis.fetch = original;
  }
});
test("Admin endpoint denies unsigned and non-admin requests", async () => {
  process.env.SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "server-only";
  const response = () => ({
    headers: {},
    setHeader(k, v) {
      this.headers[k] = v;
    },
    status(n) {
      this.code = n;
      return this;
    },
    json(d) {
      this.data = d;
    },
  });
  let res = response();
  await handler({ method: "GET", headers: {} }, res);
  assert.equal(res.code, 401);
  const original = globalThis.fetch;
  globalThis.fetch = async (url) =>
    new Response(
      JSON.stringify(
        url.endsWith("/auth/v1/user")
          ? { id: "123" }
          : [{ role: "editor", active: true }],
      ),
      { status: 200 },
    );
  try {
    res = response();
    await handler(
      { method: "GET", headers: { authorization: "Bearer signed-user-token" } },
      res,
    );
    assert.equal(res.code, 403);
  } finally {
    globalThis.fetch = original;
  }
});
