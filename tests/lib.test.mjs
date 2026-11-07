import test from "node:test";
import assert from "node:assert/strict";
import {
  markdown,
  markdownWithOutline,
  slugify,
  filterPages,
  canEdit,
  canPublish,versionKey,compareVersions,
} from "../public/lib.js";
test("Markdown escapes executable HTML and unsafe links", () => {
  const html = markdown(
    "<img src=x onerror=alert(1)>\n[click](javascript:alert)\n**safe**",
  );
  assert.ok(!html.includes("<img"));
  assert.ok(!html.includes('href="javascript:'));
  assert.ok(html.includes("<strong>safe</strong>"));
});
test("Markdown renders headings, lists, code, and private attachment references", () => {
  const html = markdown(
    "# Title\n- One\n- Two\n\n```js\n<script>\n```\n[PDF](attachment:abc/report.pdf)",
  );
  assert.ok(html.includes("<h2>Title</h2>"));
  assert.ok(html.replace(/\s+/g, "").includes("<ul><li>One</li>"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes('data-file="abc/report.pdf"'));
});
test("Document outline links to unique, sanitized Markdown headings", () => {
  const result = markdownWithOutline("# Overview\n\n## Details\n\n# Overview\n\n<script>alert(1)</script>");
  assert.deepEqual(result.outline.map((item) => item.id), [
    "section-overview",
    "section-details",
    "section-overview-2",
  ]);
  assert.ok(result.html.includes('id="section-overview-2"'));
  assert.ok(!result.html.includes("<script>"));
});
test("Roles keep edit and publish permissions distinct", () => {
  assert.equal(canEdit("editor"), false);
  assert.equal(canEdit("publisher"),true);
  assert.equal(canPublish("editor"), false);
  assert.equal(canEdit("viewer"), false);
  assert.equal(canPublish("publisher"), true);
  assert.equal(canPublish(null), false);
});
test("Search combines vertical, type, body and tag filters", () => {
  const pages = [
    {
      title: "Update",
      summary: "",
      body: "New booking flow",
      tags: ["mobile"],
      kind: "release",
      vertical_id: "a",
    },
    {
      title: "Guide",
      body: "Booking",
      tags: [],
      kind: "sop",
      vertical_id: "b",
    },
  ];
  assert.equal(
    filterPages(pages, { query: "mobile", kind: "release", vertical: "a" })
      .length,
    1,
  );
  assert.equal(
    filterPages(pages, { query: "booking", vertical: "b" }).length,
    1,
  );
  assert.equal(filterPages(pages, { query: "missing" }).length, 0);
});
test("Slugs normalize headings safely", () =>
  assert.equal(slugify(" Hoora: Release v2.4! "), "hoora-release-v2-4"));

test('Version navigation normalizes v prefixes and orders newest versions first',()=>{assert.equal(versionKey(' V5.11.0 '),'5.11.0');assert.deepEqual(['5.9.0','5.11.0-rc.1','5.11.0','5.10.0'].sort(compareVersions),['5.11.0','5.11.0-rc.1','5.10.0','5.9.0']);});
