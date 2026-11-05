import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { TableKit } from '@tiptap/extension-table';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';

/** Mount a visual Markdown editor while keeping the existing textarea as the saved source. */
export function mountRichEditor({ root, textarea, onChange, resolveImage }) {
  if (!root || !textarea) return null;
  const initial = textarea.value;
  const EditorImage = Image.extend({
    addNodeView() {
      return ({ node }) => {
        const container = document.createElement('span');
        container.className = 'rich-image-attachment';
        const preview = document.createElement('img');
        preview.alt = node.attrs.alt || 'Document image';
        const src = String(node.attrs.src || '');
        if (src.startsWith('attachment:') && resolveImage) {
          const label = document.createElement('span');
          label.textContent = 'Loading image…';
          container.append(label);
          resolveImage(src).then((blob) => {
            if (!container.isConnected) return;
            const url = URL.createObjectURL(blob);
            preview.src = url;
            preview.addEventListener('load', () => URL.revokeObjectURL(url), { once: true });
            label.remove();
          }).catch(() => { label.textContent = 'Image unavailable'; });
        } else if (/^https:\/\//i.test(src)) {
          preview.src = src;
        } else {
          preview.alt = node.attrs.alt || 'Image unavailable';
        }
        container.append(preview);
        return { dom: container };
      };
    },
  });
  const editor = new Editor({
    element: root.querySelector('[data-rich-canvas]'),
    extensions: [
      StarterKit,
      Markdown,
      TableKit,
      EditorImage,
      Link.configure({ openOnClick: false, autolink: true, defaultProtocol: 'https' }),
    ],
    content: initial || '<p></p>',
    contentType: initial ? 'markdown' : 'html',
    editorProps: {
      attributes: {
        class: 'rich-content prose',
        'aria-label': 'Document content',
        spellcheck: 'true',
      },
    },
    onUpdate: ({ editor }) => {
      textarea.value = editor.getMarkdown();
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      onChange?.(textarea.value);
    },
    onSelectionUpdate: () => updateToolbar(),
  });
  const buttons = [...root.querySelectorAll('[data-rich-command]')];
  const updateToolbar = () => {
    for (const b of buttons) {
      const name = b.dataset.richCommand;
      const active = name === 'heading' ? editor.isActive('heading', { level: 2 }) :
        name === 'bulletList' ? editor.isActive('bulletList') :
        name === 'orderedList' ? editor.isActive('orderedList') :
        name === 'blockquote' ? editor.isActive('blockquote') :
        name === 'codeBlock' ? editor.isActive('codeBlock') : editor.isActive(name);
      b.setAttribute('aria-pressed', String(active));
      b.classList.toggle('active', active);
    }
  };
  const click = (event) => {
    const button = event.target.closest('[data-rich-command]');
    if (!button || !root.contains(button)) return;
    const name = button.dataset.richCommand;
    const chain = editor.chain().focus();
    if (name === 'heading') chain.toggleHeading({ level: 2 }).run();
    else if (name === 'bold') chain.toggleBold().run();
    else if (name === 'italic') chain.toggleItalic().run();
    else if (name === 'strike') chain.toggleStrike().run();
    else if (name === 'bulletList') chain.toggleBulletList().run();
    else if (name === 'orderedList') chain.toggleOrderedList().run();
    else if (name === 'blockquote') chain.toggleBlockquote().run();
    else if (name === 'codeBlock') chain.toggleCodeBlock().run();
    else if (name === 'table') chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
    else if (name === 'link') {
      const href = window.prompt('Link URL', editor.getAttributes('link').href || 'https://');
      if (!href) return;
      try {
        const url = new URL(href);
        if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Invalid protocol');
        chain.extendMarkRange('link').setLink({ href: url.href }).run();
      } catch { window.alert('Use an http or https link.'); }
    }
    updateToolbar();
  };
  root.addEventListener('click', click);
  updateToolbar();
  return {
    editor,
    getMarkdown: () => editor.getMarkdown(),
    setMarkdown(value) { editor.commands.setContent(value || '', { contentType: 'markdown' }); },
    focus() { editor.commands.focus(); },
    destroy() { root.removeEventListener('click', click); editor.destroy(); },
  };
}
