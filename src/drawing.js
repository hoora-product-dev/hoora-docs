import React from 'react';
import { createRoot } from 'react-dom/client';
import { Excalidraw, exportToBlob, serializeAsJSON } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import { validateDrawing } from '../public/editor/drawing-data.js';

/** Fullscreen drawing workspace, loaded only when a drawing is opened. */
/**
 * Photos placed in a drawing are stored inside it, so they get the same treatment as
 * every other upload: at most 1920px on the long side and WebP. Vector images stay as is.
 */
async function compressDrawingImages(files) {
  const out = {};
  for (const [id, file] of Object.entries(files)) {
    if (!/^image\/(png|jpeg|webp)$/.test(file.mimeType)) {
      out[id] = file;
      continue;
    }
    const image = new Image();
    image.src = file.dataURL;
    await image.decode();
    const ratio = Math.min(1, 1920 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    const dataURL = canvas.toDataURL('image/webp', 0.76);
    out[id] =
      dataURL.startsWith('data:image/webp') && dataURL.length < file.dataURL.length
        ? { ...file, mimeType: 'image/webp', dataURL }
        : file;
  }
  return out;
}

export function openDrawingWorkspace({
  initialData = null,
  readOnly = false,
  theme = 'dark',
} = {}) {
  if (initialData) initialData = validateDrawing(initialData);
  return new Promise((resolve) => {
    const host = document.createElement('dialog');
    host.className = 'drawing-workspace';
    host.setAttribute('aria-label', readOnly ? 'View drawing' : 'Drawing editor');
    host.innerHTML =
      '<header class="drawing-workspace-header"><strong>Drawing</strong><span class="drawing-status" role="status"></span><input type="file" accept=".excalidraw,.json,.txt,application/json" hidden><button type="button" class="btn outline" data-drawing-import>Open file</button><button type="button" class="btn outline" data-drawing-cancel>Cancel</button><button type="button" class="btn primary" data-drawing-save>Insert drawing</button></header><div class="drawing-canvas"></div>';
    document.body.append(host);
    host.showModal();
    const canvas = host.querySelector('.drawing-canvas'),
      root = createRoot(canvas),
      status = host.querySelector('.drawing-status'),
      save = host.querySelector('[data-drawing-save]');
    let api,
      dirty = false,
      baseline = null;
    const finish = (value) => {
      root.unmount();
      host.close();
      host.remove();
      resolve(value);
    };
    const cancel = () => {
      if (dirty && !readOnly && status.dataset.confirm !== 'true') {
        status.textContent = 'Unsaved drawing. Select Cancel again to discard.';
        status.dataset.confirm = 'true';
        return;
      }
      finish(null);
    };
    host.addEventListener('cancel', (event) => {
      event.preventDefault();
      cancel();
    });
    host.querySelector('[data-drawing-cancel]').addEventListener('click', cancel);
    window.EXCALIDRAW_ASSET_PATH = '/vendor/excalidraw/';
    function mount(data) {
      root.render(
        React.createElement(Excalidraw, {
          theme,
          initialData: data,
          viewModeEnabled: readOnly,
          excalidrawAPI: (instance) => (api = instance),
          onChange: (elements) => {
            const signature = JSON.stringify(elements.map((e) => [e.id, e.version, e.isDeleted]));
            if (baseline === null) baseline = signature;
            else if (signature !== baseline) dirty = true;
          },
          UIOptions: {
            canvasActions: {
              loadScene: false,
              saveToActiveFile: false,
              saveAsImage: false,
              export: false,
            },
            tools: { image: !readOnly },
          },
        }),
      );
    }
    mount(initialData);
    if (readOnly) {
      save.hidden = true;
      host.querySelector('[data-drawing-import]').hidden = true;
      host.querySelector('[data-drawing-cancel]').textContent = 'Close';
    }
    host
      .querySelector('[data-drawing-import]')
      .addEventListener('click', () => host.querySelector('input').click());
    host.querySelector('input').addEventListener('change', async (event) => {
      try {
        const file = event.target.files[0];
        if (!file) return;
        if (file.size > 10 * 1024 * 1024) throw Error('Choose a drawing smaller than 10 MB.');
        const data = validateDrawing(JSON.parse(await file.text()));
        api.updateScene({ elements: data.elements, appState: data.appState });
        api.addFiles(Object.values(data.files));
        status.textContent = 'Drawing opened.';
        dirty = true;
      } catch (error) {
        status.textContent = error.message;
      }
    });
    save.addEventListener('click', async () => {
      if (!api) return;
      save.disabled = true;
      save.setAttribute('aria-busy', 'true');
      try {
        const elements = api.getSceneElements();
        if (!elements.length) throw Error('Add something to your drawing first.');
        const appState = api.getAppState(),
          files = await compressDrawingImages(api.getFiles());
        const preview = await exportToBlob({
          elements,
          appState: { ...appState, exportBackground: false },
          files,
          mimeType: 'image/png',
          getDimensions: (width, height) => {
            const scale = Math.min(1, 1920 / Math.max(width, height));
            return { width: Math.ceil(width * scale), height: Math.ceil(height * scale), scale };
          },
        });
        const scene = serializeAsJSON(elements, appState, files, 'database');
        if (scene.length > 10 * 1024 * 1024)
          throw Error('This drawing is too large to store. Remove large images and try again.');
        finish({ preview, scene });
      } catch (error) {
        status.textContent = error.message;
        save.disabled = false;
        save.removeAttribute('aria-busy');
      }
    });
  });
}
