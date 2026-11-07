/** Insert files and editable drawings through the existing private upload pipeline. */
export function bindEditorAssets({ getEditor, upload, resolveImage, toast }) {
  let drawingStyles;
  document.addEventListener('click', async (event) => {
    const action = event.target.closest('[data-editor-asset]'),
      drawing = event.target.closest('[data-drawing-source]');
    if (!action && !drawing) return;
    const sourceForm = document.querySelector('#contribution-form,#editor-form'),
      releaseId = sourceForm?.dataset.releaseId || null;
    const editor = getEditor(),
      source = sourceForm?.querySelector('#entry-body,#body');
    if (action?.dataset.editorAsset === 'file') {
      sourceForm?.querySelector('#entry-attachment,#file-upload')?.click();
      return;
    }
    if (action?.dataset.editorAsset !== 'drawing' && !drawing) return;
    const captured = sourceForm;
    let initialData = null,
      targetPosition = null;
    if (drawing && editor)
      editor.editor.state.doc.descendants((node, pos) => {
        if (
          node.type.name === 'image' &&
          node.attrs.title === 'drawing:attachment:' + drawing.dataset.drawingSource
        ) {
          targetPosition = pos;
          return false;
        }
      });
    try {
      if (drawing) {
        const path = drawing.dataset.drawingSource;
        if (!/^[a-f0-9-]{36}\/[A-Za-z0-9_.-]+\.txt$/i.test(path))
          throw Error('Drawing unavailable.');
        const blob = await resolveImage('attachment:' + path);
        if (blob.size > 10 * 1024 * 1024) throw Error('Drawing is too large.');
        initialData = JSON.parse(await blob.text());
        if (
          initialData.type !== 'excalidraw' ||
          !Array.isArray(initialData.elements) ||
          initialData.elements.length > 5000
        )
          throw Error('Drawing unavailable.');
      }
      drawingStyles ||= new Promise((resolve, reject) => {
        const link = document.createElement('link');
        link.id = 'drawing-styles';
        link.rel = 'stylesheet';
        link.href = '/vendor/drawing/drawing.css';
        link.onload = resolve;
        link.onerror = () => {
          link.remove();
          drawingStyles = null;
          reject(Error('Drawing styles could not load.'));
        };
        document.head.append(link);
      });
      await drawingStyles;
      const { openDrawingWorkspace } = await import('../vendor/drawing/drawing.js');
      const result = await openDrawingWorkspace({
        initialData,
        readOnly: !captured,
        theme: document.documentElement.dataset.theme || 'dark',
      });
      if (!result) return;
      if (!captured?.isConnected) throw Error('Reopen your editor to insert the drawing.');
      const preview = await upload(
        new File([result.preview], 'drawing.png', { type: 'image/png' }),
        releaseId,
        { insert: false },
      );
      const scene = await upload(
        new File([result.scene], 'drawing.excalidraw.txt', { type: 'text/plain' }),
        releaseId,
        { insert: false },
      );
      const attrs = { src: preview.src, alt: 'Drawing', title: 'drawing:' + scene.src };
      if (editor && !editor.editor.isDestroyed) {
        if (
          targetPosition !== null &&
          editor.editor.state.doc.nodeAt(targetPosition)?.type.name === 'image'
        )
          editor.editor.commands.command(({ tr }) => {
            tr.setNodeMarkup(targetPosition, null, attrs);
            return true;
          });
        else editor.editor.chain().focus().setImage(attrs).run();
      } else {
        source.setRangeText(
          '\n\n![Drawing](' + preview.src + ' "' + attrs.title + '")\n',
          source.selectionStart,
          source.selectionEnd,
          'end',
        );
        source.dispatchEvent(new Event('input', { bubbles: true }));
      }
      toast('Drawing added.');
    } catch (error) {
      toast(error.message || 'The drawing could not be opened.', true);
    }
  });
}
