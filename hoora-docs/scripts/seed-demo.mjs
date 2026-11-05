import { loadEnvFile } from "node:process";
import { readFile } from "node:fs/promises";
loadEnvFile();
const url = process.env.SUPABASE_URL,
  key = process.env.SUPABASE_ANON_KEY;
const credentials = JSON.parse(
  await readFile(".credentials.admin.json", "utf8"),
);
const login = await fetch(url + "/auth/v1/token?grant_type=password", {
  method: "POST",
  headers: { apikey: key, "Content-Type": "application/json" },
  body: JSON.stringify(credentials),
});
const session = await login.json();
if (!login.ok) throw new Error("Sign in failed");
async function call(path, method = "GET", body) {
  const r = await fetch(url + "/rest/v1/" + path, {
    method,
    headers: {
      apikey: key,
      Authorization: "Bearer " + session.access_token,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const d = await r.json().catch(() => null);
  if (!r.ok) throw new Error(d?.message || "Request failed");
  return d;
}
let [project] = await call("docs_projects?name=eq.Demo%20Customer%20App");
if (!project)
  [project] = await call("docs_projects", "POST", {
    name: "Demo Customer App",
    description:
      "Example content for learning the shared release workflow. Not an actual product release.",
  });
let [release] = await call(
  "docs_releases?project_id=eq." + project.id + "&version=eq.5.11.0",
);
if (!release) {
  const id = await call("rpc/docs_create_release", "POST", {
    project: project.id,
    release_version: "5.11.0",
    description:
      "DEMO — Explore a shared release with contributions grouped by vertical. This is sample content, not an actual Customer App release.",
  });
  release = { id };
  const verticals = await call("docs_verticals?select=id,name");
  for (const [vertical, title, body, tickets] of [
    [
      "Auto Care",
      "A clearer booking experience",
      "- Show available appointment slots before checkout.\n- Clarify the service inclusions on the booking page.\n\n*Demonstration content only.*",
      "DEMO-101, DEMO-102",
    ],
    [
      "Garage Services",
      "Service status and handover",
      "- Explain each service status in plain language.\n- Include a handover checklist for the garage team.\n\n*Demonstration content only.*",
      "DEMO-201, DEMO-202",
    ],
    [
      "Products & Accessories",
      "Product discovery and checkout",
      "- Group compatible accessories by vehicle.\n- Explain delivery estimates before payment.\n\n*Demonstration content only.*",
      "DEMO-301, DEMO-302",
    ],
    [
      "VSA",
      "Advisor follow-up workflow",
      "- Show the next follow-up action alongside each request.\n- Add clear ownership to unresolved customer requests.\n\n*Demonstration content only.*",
      "DEMO-401, DEMO-402",
    ],
  ])
    await call("docs_entries", "POST", {
      release_id: release.id,
      vertical_id: verticals.find((v) => v.name === vertical).id,
      title,
      body,
      tickets,
      submitted: true,
    });
  await call("rpc/docs_publish", "POST", { page_id: release.id });
}
const [published] = await call(
  "docs_published?id=eq." + release.id + "&select=slug",
);
console.log(
  JSON.stringify({
    id: release.id,
    publicLink: "https://hoora-docs.vercel.app/#/doc/" + published.slug,
  }),
);
