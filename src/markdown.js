import { marked } from 'marked';
import createDOMPurify from 'dompurify';
import { describeResource } from '../public/resources.js';
const escape = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
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
    if (text === 'Preview') {
      const resource = describeResource(href);
      if (resource)
        return `<span class="resource-preview"><span class="resource-preview-info"><strong>${escape(resource.title)}</strong><small>${escape(resource.host)}</small></span>${resource.videoId ? `<button type="button" class="btn outline" data-load-video="${escape(resource.url)}">Load video</button>` : `<a class="btn outline" href="${escape(resource.url)}" target="_blank" rel="noopener noreferrer">Open link</a>`}</span>`;
    }
    if (href.startsWith('attachment:') && /^[a-zA-Z0-9/_.-]+$/.test(href.slice(11)))
      return `<button type="button" class="attachment-link" data-file="${escape(href.slice(11))}">${text}</button>`;
    if (!/^(https?:\/\/|mailto:|#)/i.test(href)) return text;
    return `<a href="${escape(href)}" target="_blank" rel="noopener noreferrer">${text}</a>`;
  },
  image({ href, text, title }) {
    if (href.startsWith('attachment:') && /^[a-zA-Z0-9/_.-]+$/.test(href.slice(11)))
      return `<span class="document-image"><img data-storage-image="${escape(href.slice(11))}" alt="${escape(text)}" loading="lazy">${typeof title === 'string' && /^drawing:attachment:[a-f0-9-]{36}\/[A-Za-z0-9_.-]+\.txt$/i.test(title) ? `<button type="button" class="btn text" data-drawing-source="${escape(title.slice('drawing:attachment:'.length))}">Open drawing</button>` : ''}</span>`;
    return /^https:\/\//i.test(href)
      ? `<img src="${escape(href)}" alt="${escape(text)}" loading="lazy" referrerpolicy="no-referrer">`
      : escape(text);
  },
};
marked.use({ renderer, gfm: true, breaks: false });
export function renderMarkdown(text) {
  const purify = createDOMPurify.sanitize ? createDOMPurify : createDOMPurify(globalThis.window);
  return purify.sanitize(marked.parse(String(text ?? '')), {
    USE_PROFILES: { html: true },
    ADD_ATTR: [
      'target',
      'data-file',
      'data-storage-image',
      'data-load-video',
      'data-drawing-source',
    ],
    FORBID_TAGS: ['iframe', 'form', 'input', 'style', 'script'],
    FORBID_ATTR: ['style'],
  });
}
