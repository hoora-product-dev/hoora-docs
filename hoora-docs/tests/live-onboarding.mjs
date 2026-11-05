import { loadEnvFile } from "node:process";
import assert from "node:assert/strict";
import handler from "../api/onboarding.js";
loadEnvFile();
const url = process.env.SUPABASE_URL,
  key = process.env.SUPABASE_ANON_KEY,
  service = process.env.SUPABASE_SERVICE_ROLE_KEY;
let id;
async function call(path, token = service, method = "GET", body) {
  const r = await fetch(url + path, {
    method,
    headers: {
      apikey: token === service ? service : key,
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, data: await r.json().catch(() => null) };
}
try {
  const email = "onboard-" + crypto.randomUUID() + "@example.com",
    password = crypto.randomUUID() + "A!";
  const { data: user } = await call("/auth/v1/admin/users", service, "POST", {
    email,
    password,
    email_confirm: true,
  });
  id = user.id;
  await call("/rest/v1/docs_members", service, "POST", {
    id,
    email,
    name: "Temporary onboarding test",
    role: "viewer",
    password_setup_complete: false,
  });
  const { data: session } = await call(
    "/auth/v1/token?grant_type=password",
    key,
    "POST",
    { email, password },
  );
  const newPassword = crypto.randomUUID() + "B!";
  const res = {
    setHeader() {},
    status(n) {
      this.code = n;
      return this;
    },
    json(d) {
      this.data = d;
    },
  };
  await handler(
    {
      method: "POST",
      headers: { authorization: "Bearer " + session.access_token },
      body: { password: newPassword, confirmPassword: newPassword },
    },
    res,
  );
  assert.equal(res.code, 200, JSON.stringify(res.data));
  const active = await call("/auth/v1/user", session.access_token);
  assert.equal(active.status, 200, JSON.stringify(active.data));
  const signIn = await call("/auth/v1/token?grant_type=password", key, "POST", {
    email,
    password: newPassword,
  });
  assert.equal(signIn.status, 200);
  const {
    data: [member],
  } = await call("/rest/v1/docs_members?id=eq." + id);
  assert.equal(member.password_setup_complete, true);
  console.log(
    "PASS password confirmation, setup completion, current-session preservation, and new-password login",
  );
} finally {
  if (id) await call("/auth/v1/admin/users/" + id, service, "DELETE");
}
