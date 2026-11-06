import { renderMarkdown } from "./vendor/markdown.js";
export const escapeHtml = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export const slugify = (s) =>
  String(s)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
export function markdown(input) {
  return renderMarkdown(input);
}
export function markdownWithOutline(input) {
  const container = document.createElement("div");
  container.innerHTML = markdown(input);
  const counts = new Map();
  const outline = [...container.querySelectorAll("h2, h3, h4")].map((heading) => {
    const title = heading.textContent.trim();
    const base = slugify(title) || "section";
    const count = (counts.get(base) || 0) + 1;
    counts.set(base, count);
    const id = `section-${base}${count > 1 ? `-${count}` : ""}`;
    heading.id = id;
    heading.tabIndex = -1;
    return { id, title, level: Number(heading.tagName.slice(1)) };
  });
  return { html: container.innerHTML, outline };
}
export const canEdit = (role) =>
  ["admin", "publisher"].includes(role);
export const canPublish = (role) => ["admin", "publisher"].includes(role);
export const versionKey = value => String(value||'').trim().replace(/^v(?=\d)/i,'');
export function compareVersions(a,b){
 const av=versionKey(a).split('-'),bv=versionKey(b).split('-'),an=av[0].split('.').map(Number),bn=bv[0].split('.').map(Number);
 if(an.every(Number.isFinite)&&bn.every(Number.isFinite)){for(let i=0;i<Math.max(an.length,bn.length);i++){const difference=(bn[i]||0)-(an[i]||0);if(difference)return difference;}if(!!av[1]!==!!bv[1])return av[1]?1:-1;}
 return versionKey(b).localeCompare(versionKey(a),undefined,{numeric:true});
}
export function filterPages(
  pages,
  { query = "", kind = "", vertical = "", folder = "" } = {},
) {
  const q = query.toLowerCase();
  return pages.filter(
    (p) =>
      (!kind || p.kind === kind) &&
      (!vertical ||
        p.vertical_id === vertical ||
        p.release_snapshot?.entries?.some((n) => n.vertical_id === vertical)) &&
      (!folder || p.folder_id === folder) &&
      (!q ||
        [p.title, p.summary, p.body, ...(p.tags || [])]
          .join(" ")
          .toLowerCase()
          .includes(q)),
  );
}
