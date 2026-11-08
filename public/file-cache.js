// Private files (images, PDFs, attachments) are stored under names that never change,
// so a file fetched once is kept in memory for the session. Opening the same page or
// document again costs no download and no Supabase egress. The cache lives only in
// memory, so it is gone when the app closes or the person signs out.
const LIMIT_BYTES = 60 * 1024 * 1024;

export function createFileCache({ url, key, getToken }) {
  const files = new Map();
  let bytes = 0;

  function remember(path, blob) {
    files.set(path, blob);
    bytes += blob.size;
    // Oldest first, until the cache fits again.
    for (const [oldPath, oldBlob] of files) {
      if (bytes <= LIMIT_BYTES) break;
      files.delete(oldPath);
      bytes -= oldBlob.size;
    }
  }

  async function get(path) {
    if (!/^[a-zA-Z0-9/_.-]+$/.test(path)) throw new Error('Invalid file');
    const cached = files.get(path);
    if (cached) {
      files.delete(path);
      files.set(path, cached); // most recently used last
      return cached;
    }
    const token = await getToken();
    const response = await fetch(`${url}/storage/v1/object/authenticated/hoora-docs/${path}`, {
      headers: { apikey: key, ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) throw new Error('This file is unavailable or you don’t have access.');
    const blob = await response.blob();
    remember(path, blob);
    return blob;
  }

  function clear() {
    files.clear();
    bytes = 0;
  }

  return { get, clear };
}
