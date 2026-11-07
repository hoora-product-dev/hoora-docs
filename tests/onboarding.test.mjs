import test from "node:test";
import assert from "node:assert/strict";
import handler from "../api/onboarding.js";
const response = () => ({
  setHeader() {},
  status(n) {
    this.code = n;
    return this;
  },
  json(d) {
    this.data = d;
  },
});
test("First Microsoft password setup requires a verified OAuth session and matching passwords", async () => {
  process.env.SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "server";
  const original = fetch;
  let writes = 0;
  globalThis.fetch = async (url, options = {}) => {
    if (options.method === "PUT" || options.method === "PATCH") writes++;
    return new Response(
      JSON.stringify(
        url.endsWith("/auth/v1/user")
          ? { id: "123" }
          : url.includes("/docs_members")
            ? [
                {
                  active: true,
                  auth_source: "microsoft",
                  password_setup_complete: false,
                  microsoft_subject: "verified",
                },
              ]
            : {},
      ),
    );
  };
  try {
    for (const [method, confirm] of [
      ["password", "LongStrongPassword!"],
      ["oauth", "DoesNotMatch!"],
    ]) {
      const token =
        "x." +
        Buffer.from(JSON.stringify({ amr: [{ method }] })).toString(
          "base64url",
        ) +
        ".x";
      const res = response();
      await handler(
        {
          method: "POST",
          headers: { authorization: "Bearer " + token },
          body: { password: "LongStrongPassword!", confirmPassword: confirm },
        },
        res,
      );
      assert.equal(res.code, 400);
      assert.equal(writes, 0);
    }
    const token =
      "x." +
      Buffer.from(JSON.stringify({ amr: [{ method: "oauth" }] })).toString(
        "base64url",
      ) +
      ".x";
    const res = response();
    await handler(
      {
        method: "POST",
        headers: { authorization: "Bearer " + token },
        body: {
          password: "LongStrongPassword!",
          confirmPassword: "LongStrongPassword!",
        },
      },
      res,
    );
    assert.equal(res.code, 200);
    assert.equal(writes, 2);
  } finally {
    globalThis.fetch = original;
  }
});
