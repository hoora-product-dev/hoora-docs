import test from "node:test";
import assert from "node:assert/strict";
import handler, {
  signTicket,
  verifyTicket,
  artifactCsp,
} from "../api/artifact.js";
const secret = "a-long-random-test-secret-of-more-than-32-characters";
test("Artifact tickets reject tampering, wrong secrets, and expiry", () => {
  const payload = { id: "123", expires: Date.now() + 10000 };
  const token = signTicket(payload, secret);
  assert.deepEqual(verifyTicket(token, secret), payload);
  assert.throws(() => verifyTicket(token + "x", secret));
  assert.throws(() => verifyTicket(token, "wrong-secret"));
  assert.throws(() =>
    verifyTicket(signTicket({ expires: Date.now() - 1 }, secret), secret),
  );
});
test("Artifact previews have an opaque sandbox with no origin or parent navigation access", () => {
  assert.ok(artifactCsp.includes("sandbox allow-scripts allow-downloads"));
  assert.ok(!artifactCsp.includes("allow-same-origin"));
  assert.ok(!artifactCsp.includes("allow-top-navigation"));
  assert.ok(artifactCsp.includes("form-action 'none'"));
});
test("Private artifact preview requires a real active member", async () => {
  process.env.ARTIFACT_SIGNING_SECRET = secret;
  process.env.SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test";
  const res = {
    setHeader() {},
    status(code) {
      this.code = code;
      return this;
    },
    json(data) {
      this.data = data;
    },
  };
  await handler(
    {
      method: "POST",
      headers: {},
      body: { id: "12345678-1234-1234-1234-123456789012", draft: true },
    },
    res,
  );
  assert.equal(res.code, 401);
});
test("Unpublished public artifact tickets cannot be issued", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response("[]", { status: 200 });
  const res = {
    setHeader() {},
    status(code) {
      this.code = code;
      return this;
    },
    json(data) {
      this.data = data;
    },
  };
  try {
    await handler(
      {
        method: "POST",
        headers: {},
        body: { id: "12345678-1234-1234-1234-123456789012" },
      },
      res,
    );
    assert.equal(res.code, 404);
  } finally {
    globalThis.fetch = original;
  }
});
