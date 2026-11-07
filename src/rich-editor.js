import { Editor, Node } from '@tiptap/core';
import { describeResource } from '../public/resources.js';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { TableKit } from '@tiptap/extension-table';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';

/** Mount a visual Markdown editor while keeping the existing textarea as the saved source. */
export function mountRichEditor({ root, textarea, onChange, resolveImage, onUpload, onError }) {
  if (!root || !textarea) return null;
  const initial = textarea.value;
  const ResourceCard = Node.create({
    name: 'resourceCard',
    group: 'block',
    atom: true,
    addAttributes() {
      return { url: { default: '' } };
    },
    parseHTML() {
      return [
        {
          tag: 'div[data-resource-url]',
          getAttrs: (element) => ({ url: element.dataset.resourceUrl }),
        },
      ];
    },
    renderHTML({ node }) {
      const r = describeResource(node.attrs.url);
      return [
        'div',
        { 'data-resource-url': r?.url || '', class: 'resource-preview' },
        [
          'div',
          { class: 'resource-preview-info' },
          ['strong', {}, r?.title || 'Link'],
          ['small', {}, r?.host || ''],
        ],
      ];
    },
    markdownTokenName: 'resourceCard',
    markdownTokenizer: {
      name: 'resourceCard',
      level: 'block',
      start: '[Preview](',
      tokenize: (source) => {
        const m = /^\[Preview\]\((https?:\/\/(?:[^\s()]|\([^\s()]*\))+)\)[ \t]*(?:\n|$)/.exec(
          source,
        );
        return m && describeResource(m[1])
          ? { type: 'resourceCard', raw: m[0], url: m[1] }
          : undefined;
      },
    },
    parseMarkdown: (token, helpers) => helpers.createNode('resourceCard', { url: token.url }),
    renderMarkdown: (node) => '[Preview](' + node.attrs.url + ')\n',
  });
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
          resolveImage(src)
            .then((blob) => {
              if (!container.isConnected) return;
              const url = URL.createObjectURL(blob);
              preview.src = url;
              preview.addEventListener('load', () => URL.revokeObjectURL(url), { once: true });
              label.remove();
            })
            .catch(() => {
              label.textContent = 'Image unavailable';
            });
        } else if (/^https:\/\//i.test(src)) {
          preview.src = src;
        } else {
          preview.alt = node.attrs.alt || 'Image unavailable';
        }
        container.append(preview);
        const source = String(node.attrs.title || '');
        if (source.startsWith('drawing:attachment:')) {
          const edit = document.createElement('button');
          edit.type = 'button';
          edit.className = 'btn outline drawing-edit';
          edit.textContent = 'Edit drawing';
          edit.dataset.drawingSource = source.slice('drawing:attachment:'.length);
          edit.contentEditable = 'false';
          container.append(edit);
        }
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
      ResourceCard,
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
      handlePaste(view, event) {
        const files = [...(event.clipboardData?.files || [])].filter((file) =>
          file.type.startsWith('image/'),
        );
        if (files.length && onUpload) {
          event.preventDefault();
          insertFiles(files, view.state.selection.from);
          return true;
        }
        const text = (event.clipboardData?.getData('text/plain') || '').trim(),
          resource = describeResource(text);
        if (resource && /^https?:\/\/\S+$/.test(text)) {
          event.preventDefault();
          if (!view.state.selection.empty)
            editor.chain().focus().setLink({ href: resource.url }).run();
          else
            editor
              .chain()
              .focus()
              .insertContent([
                { type: 'resourceCard', attrs: { url: resource.url } },
                { type: 'paragraph' },
              ])
              .run();
          return true;
        }
        return false;
      },
      handleDrop(view, event, _slice, moved) {
        const files = [...(event.dataTransfer?.files || [])];
        if (!moved && files.length && onUpload) {
          event.preventDefault();
          insertFiles(
            files,
            view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ||
              view.state.selection.from,
          );
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor }) => {
      textarea.value = editor.getMarkdown();
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      onChange?.(textarea.value);
    },
    onSelectionUpdate: () => updateToolbar(),
  });
  async function insertFiles(files, start) {
    let position = start;
    const track = ({ transaction }) => {
      position = transaction.mapping.map(position);
    };
    editor.on('transaction', track);
    root.dataset.uploading = 'true';
    try {
      for (const file of files) {
        const uploaded = await onUpload(file);
        if (editor.isDestroyed || !uploaded) break;
        const content = uploaded.file?.type?.startsWith('image/')
          ? { type: 'image', attrs: { src: uploaded.src, alt: uploaded.alt || file.name } }
          : {
              type: 'text',
              text: uploaded.alt || file.name,
              marks: [{ type: 'link', attrs: { href: uploaded.src } }],
            };
        editor.commands.insertContentAt(Math.min(position, editor.state.doc.content.size), content);
      }
    } catch (error) {
      onError?.(error);
    } finally {
      editor.off('transaction', track);
      delete root.dataset.uploading;
    }
  }
  const buttons = [...root.querySelectorAll('[data-rich-command]')];
  const updateToolbar = () => {
    for (const b of buttons) {
      const name = b.dataset.richCommand;
      const active =
        name === 'heading'
          ? editor.isActive('heading', { level: 2 })
          : name === 'bulletList'
            ? editor.isActive('bulletList')
            : name === 'orderedList'
              ? editor.isActive('orderedList')
              : name === 'blockquote'
                ? editor.isActive('blockquote')
                : name === 'codeBlock'
                  ? editor.isActive('codeBlock')
                  : editor.isActive(name);
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
      root.querySelector('.editor-link-field')?.remove();
      const field = document.createElement('div');
      field.className = 'editor-link-field';
      field.setAttribute('role', 'group');
      field.setAttribute('aria-label', 'Insert link');
      const input = document.createElement('input');
      input.type = 'url';
      input.placeholder = 'https://';
      input.setAttribute('aria-label', 'Link URL');
      input.value = editor.getAttributes('link').href || '';
      const apply = document.createElement('button');
      apply.type = 'button';
      apply.className = 'btn outline';
      apply.textContent = 'Add link';
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'btn text';
      cancel.textContent = 'Cancel';
      const error = document.createElement('span');
      error.className = 'error';
      error.setAttribute('role', 'alert');
      const close = () => {
        field.remove();
        editor.commands.focus();
      };
      const save = () => {
        const resource = describeResource(input.value);
        if (!resource) {
          error.textContent = 'Enter an http or https link.';
          return;
        }
        editor.chain().focus().extendMarkRange('link').setLink({ href: resource.url }).run();
        close();
      };
      apply.addEventListener('click', save);
      cancel.addEventListener('click', close);
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          save();
        }
        if (event.key === 'Escape') close();
      });
      field.append(input, apply, cancel, error);
      root.querySelector('.rich-toolbar').after(field);
      input.focus();
    }
    updateToolbar();
  };
  root.addEventListener('click', click);
  updateToolbar();
  return {
    editor,
    getMarkdown: () => editor.getMarkdown(),
    setMarkdown(value) {
      editor.commands.setContent(value || '', { contentType: 'markdown' });
    },
    focus() {
      editor.commands.focus();
    },
    async insertFiles(files) {
      return insertFiles(files, editor.state.selection.from);
    },
    destroy() {
      root.removeEventListener('click', click);
      editor.destroy();
    },
  };
}
