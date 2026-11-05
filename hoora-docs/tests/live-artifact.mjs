// Explicit integration check against the configured project. All temporary records are removed.
import { loadEnvFile } from "node:process";
import { readFile, mkdir, writeFile } from "node:fs/promises";
loadEnvFile();
const url = process.env.SUPABASE_URL,
  key = process.env.SUPABASE_ANON_KEY,
  service = process.env.SUPABASE_SERVICE_ROLE_KEY,
  base = process.env.HOORA_TEST_BASE_URL || "http://localhost:3001";
const results = [];
let userId, id, path;
async function call(route, token = service, method = "GET", body) {
  const r = await fetch(url + route, {
    method,
    headers: {
      apikey: token === service ? service : key,
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, data: await r.json().catch(() => null) };
}
async function ticket(token, body) {
  const r = await fetch(base + "/api/artifact", {
    method: "POST",
    headers: {
      ...(token ? { Authorization: "Bearer " + token } : {}),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return { status: r.status, data: await r.json() };
}
function check(name, pass, detail) {
  results.push({ name, pass, ...(!pass ? { detail } : {}) });
  if (!pass) throw new Error(name);
}
try {
  const email = "artifact-test-" + crypto.randomUUID() + "@example.com",
    password = crypto.randomUUID() + "A1!";
  const u = await call("/auth/v1/admin/users", service, "POST", {
    email,
    password,
    email_confirm: true,
  });
  userId = u.data.id;
  await call("/rest/v1/docs_members", service, "POST", {
    id: userId,
    email,
    name: "Temporary artifact test",
    role: "publisher",
  });
  const login = await call("/auth/v1/token?grant_type=password", key, "POST", {
    email,
    password,
  });
  const editor = login.data.access_token;
  const adminCredentials = JSON.parse(
    await readFile(".credentials.admin.json", "utf8"),
  );
  const adminLogin = await call(
    "/auth/v1/token?grant_type=password",
    key,
    "POST",
    adminCredentials,
  );
  const admin = adminLogin.data.access_token;
  id = crypto.randomUUID();
  path = id + "/" + crypto.randomUUID() + "-test.html";
  const p = await call("/rest/v1/docs_pages", editor, "POST", {
    id,
    title: "Temporary HTML integration test",
    slug: "artifact-test-" + id,
    kind: "documentation",
    format: "html",
    artifact_path: path,
  });
  check("Editor can create an HTML draft", p.status === 201, p.data);
  const upload = await fetch(url + "/storage/v1/object/hoora-docs/" + path, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: "Bearer " + editor,
      "Content-Type": "text/html",
    },
    body: Buffer.concat([
      await readFile("tests/fixtures/interactive-artifact.html"),
      Buffer.from("<!--" + "x".repeat(6 * 1024 * 1024) + "-->"),
    ]),
  });
  check("HTML uploads are accepted", upload.ok, await upload.text());
  let t = await ticket(null, { id });
  check("Anonymous cannot open unpublished HTML", t.status === 404, t);
  t = await ticket(editor, { id, draft: true });
  check("Active editor can preview private HTML", t.status === 200, t);
  const preview = t.data.url;
  let r = await fetch(base + preview);
  check(
    "Private HTML response is rendered, not downloaded",
    r.status === 200 && r.headers.get("content-type").startsWith("text/html"),
    { status: r.status },
  );
  check(
    "Server enforces an opaque sandbox",
    r.headers
      .get("content-security-policy")
      ?.includes("sandbox allow-scripts allow-downloads") &&
      !r.headers.get("content-security-policy")?.includes("allow-same-origin"),
  );
  check(
    "HTML larger than Vercel buffered-response limit streams completely",
    (await r.text()).length > 6 * 1024 * 1024,
  );
  const denied = await call("/rest/v1/rpc/docs_publish", key, "POST", {
    page_id: id,
  });
  check("Anonymous visitors cannot publish an HTML artifact", denied.status >= 400);
  await call('/rest/v1/docs_pages?id=eq.'+id,admin,'PATCH',{visibility:'public'});
  await call("/rest/v1/rpc/docs_publish", admin, "POST", { page_id: id });
  t = await ticket(null, { id });
  check("Published HTML opens for anonymous readers", t.status === 200, t);
  const publicUrl = t.data.url;
  r = await fetch(base + publicUrl);
  check(
    "Published HTML retains interactive JavaScript",
    r.status === 200 && (await r.text()).includes('id="next"'),
  );
  await call("/rest/v1/docs_pages?id=eq." + id, editor, "PATCH", {
    title: "Unpublished draft changes",
  });
  r = await fetch(base + publicUrl);
  check("Draft edits do not invalidate the public snapshot", r.status === 200);
  await call("/rest/v1/rpc/docs_unpublish", admin, "POST", { page_id: id });
  r = await fetch(base + publicUrl);
  check(
    "Unpublish revokes already issued public preview tickets",
    [403,404].includes(r.status),
  );
  t = await ticket(editor, { id, draft: true });
  await call("/rest/v1/docs_members?id=eq." + userId, service, "PATCH", {
    active: false,
  });
  r = await fetch(base + t.data.url);
  check(
    "Disabling a user revokes their private preview tickets",
    r.status === 403,
  );
} catch (err) {
  results.push({ name: "Execution", pass: false, error: err.message });
  process.exitCode = 1;
} finally {
  if (path)
    await call("/storage/v1/object/hoora-docs", service, "DELETE", {
      prefixes: [path],
    });
  if (id) await call("/rest/v1/docs_pages?id=eq." + id, service, "DELETE");
  if (userId) await call("/auth/v1/admin/users/" + userId, service, "DELETE");
  await mkdir("test-results", { recursive: true });
  await writeFile(
    "test-results/live-artifact-checks.json",
    JSON.stringify(results, null, 2),
  );
  console.log(JSON.stringify(results, null, 2));
}
