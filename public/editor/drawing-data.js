/** Drawings may contain raster data, never external image fetches or executable links. */
export function validateDrawing(value) {
  if (
    value?.type !== 'excalidraw' ||
    !Array.isArray(value.elements) ||
    value.elements.length > 5000
  )
    throw Error('Choose a valid Excalidraw drawing.');
  const files = {};
  let size = 0;
  for (const [id, file] of Object.entries(value.files || {})) {
    if (
      !file ||
      !/^image\/(png|jpeg|webp|gif)$/.test(file.mimeType) ||
      typeof file.dataURL !== 'string' ||
      !/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(file.dataURL)
    )
      throw Error('Drawings can contain PNG, JPEG, WebP or GIF images only.');
    size += file.dataURL.length;
    if (size > 10 * 1024 * 1024) throw Error('This drawing is too large.');
    files[id] = {
      id: file.id || id,
      mimeType: file.mimeType,
      dataURL: file.dataURL,
      created: Number(file.created) || Date.now(),
      lastRetrieved: Number(file.lastRetrieved) || Date.now(),
    };
  }
  const elements = value.elements.map((element) => {
    if (!element || typeof element.id !== 'string') throw Error('Invalid drawing element.');
    const copy = { ...element };
    if (copy.link) {
      try {
        const url = new URL(copy.link);
        copy.link =
          /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : null;
      } catch {
        copy.link = null;
      }
    }
    return copy;
  });
  const appState = {};
  if (/^#[a-f0-9]{3,8}$/i.test(value.appState?.viewBackgroundColor))
    appState.viewBackgroundColor = value.appState.viewBackgroundColor;
  return { type: 'excalidraw', version: 2, elements, files, appState };
}
