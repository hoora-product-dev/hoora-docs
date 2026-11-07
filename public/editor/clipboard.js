/** Source-mode uploads preserve the insertion point while the author keeps typing. */
export function bindSourceFiles({ source, upload, onChange, onError }) {
  if (!source) return;
  let queue = Promise.resolve();
  function insert(files) {
    let position = source.selectionStart,
      previous = source.value;
    const track = () => {
      const next = source.value;
      let first = 0;
      while (first < previous.length && first < next.length && previous[first] === next[first])
        first++;
      let oldEnd = previous.length,
        newEnd = next.length;
      while (oldEnd > first && newEnd > first && previous[oldEnd - 1] === next[newEnd - 1]) {
        oldEnd--;
        newEnd--;
      }
      if (position >= oldEnd) position += newEnd - oldEnd;
      else if (position > first) position = newEnd;
      previous = next;
    };
    source.addEventListener('input', track);
    queue = queue
      .then(async () => {
        source.parentElement.dataset.uploading = 'true';
        for (const file of files) {
          if (!source.isConnected) break;
          const asset = await upload(file);
          if (!source.isConnected) break;
          const text =
            '\n\n' +
            (asset.file.type.startsWith('image/') ? '!' : '') +
            '[' +
            asset.alt.replace(/[\[\]]/g, '') +
            '](' +
            asset.src +
            ')\n';
          source.setRangeText(text, position, position, 'end');
          position = source.selectionEnd;
          previous = source.value;
          source.dispatchEvent(new Event('input', { bubbles: true }));
          onChange?.();
        }
      })
      .catch(onError)
      .finally(() => {
        source.removeEventListener('input', track);
        delete source.parentElement.dataset.uploading;
      });
  }
  source.addEventListener('paste', (event) => {
    const files = [...(event.clipboardData?.files || [])].filter((file) =>
      file.type.startsWith('image/'),
    );
    if (files.length) {
      event.preventDefault();
      insert(files);
    }
  });
  source.addEventListener('dragover', (event) => {
    if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
  });
  source.addEventListener('drop', (event) => {
    const files = [...(event.dataTransfer?.files || [])];
    if (files.length) {
      event.preventDefault();
      insert(files);
    }
  });
  return { insert };
}
