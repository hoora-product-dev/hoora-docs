import { marked } from "marked";
import createDOMPurify from "dompurify";
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const renderer = {
  html({ text }) {
    return marked.parse(escape(text));
  },
  heading({ tokens, depth }) {
    const level = Math.min(6, depth + 1);
    return `<h${level}>${this.parser.parseInline(tokens)}</h${level}>\n`;
  },
  link({ href, tokens }) {
    const text = this.parser.parseInline(tokens);
    if (
      href.startsWith("attachment:") &&
      /^[a-zA-Z0-9/_.-]+$/.test(href.slice(11))
    )
      return `<button type="button" class="attachment-link" data-file="${escape(href.slice(11))}">${text}</button>`;
    if (!/^(https?:\/\/|mailto:|#)/i.test(href)) return text;
    return `<a href="${escape(href)}" target="_blank" rel="noopener noreferrer">${text}</a>`;
  },
  image({ href, text }) {
    if (
      href.startsWith("attachment:") &&
      /^[a-zA-Z0-9/_.-]+$/.test(href.slice(11))
    )
      return `<img data-storage-image="${escape(href.slice(11))}" alt="${escape(text)}" loading="lazy">`;
    return /^https:\/\//i.test(href)
      ? `<img src="${escape(href)}" alt="${escape(text)}" loading="lazy" referrerpolicy="no-referrer">`
      : escape(text);
  },
};
marked.use({ renderer, gfm: true, breaks: false });
export function renderMarkdown(text) {
  const purify = createDOMPurify.sanitize
    ? createDOMPurify
    : createDOMPurify(globalThis.window);
  return purify.sanitize(marked.parse(String(text ?? "")), {
    USE_PROFILES: { html: true },
    ADD_ATTR: ["target", "data-file", "data-storage-image"],
    FORBID_TAGS: ["iframe", "form", "input", "style", "script"],
    FORBID_ATTR: ["style"],
  });
}
