export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const types = {
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
export async function prepareUpload(file) {
  if (file.type.startsWith('video/') || /\.(mp4|mov|avi|webm|mkv|mpeg|m4v)$/i.test(file.name))
    throw new Error('Video uploads are not supported.');
  // Every raster image, pasted, dropped or picked, is resized and stored as WebP.
  if (/^image\/(png|jpeg|webp|gif|bmp|avif|heic|heif|tiff)$/.test(file.type)) {
    if (file.size > 40 * 1024 * 1024)
      throw new Error('Choose an image smaller than 40 MB for compression.');
    const bitmap = await createImageBitmap(file).catch(() => {
      throw new Error(
        'This image format cannot be opened here. Save it as JPEG or PNG and try again.',
      );
    });
    if (bitmap.width * bitmap.height > 80000000) {
      bitmap.close();
      throw new Error('Image dimensions are too large.');
    }
    const ratio = Math.min(1, 1920 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
    canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    let blob;
    for (const quality of [0.76, 0.6, 0.45]) {
      blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
      if (!blob || blob.type !== 'image/webp')
        throw new Error('This browser cannot convert images to WebP.');
      if (blob.size <= 1024 * 1024) break;
    }
    file = new File([blob], file.name.replace(/\.[^.]+$/, '') + '.webp', {
      type: 'image/webp',
    });
  } else {
    const ext = file.name.split('.').at(-1).toLowerCase();
    if (!types[ext])
      throw new Error(
        'Choose an image, PDF, Markdown, text, CSV, Word, or Excel file. Videos are not supported.',
      );
    if (ext === 'pdf' && file.size > MAX_UPLOAD_BYTES) {
      if (file.size > 30 * 1024 * 1024)
        throw new Error(
          'Choose a PDF smaller than 30 MB to attempt compression. The final upload must be 10 MB or less.',
        );
      try {
        const { PDFDocument } = await import('./pdf.js');
        const pdf = await PDFDocument.load(await file.arrayBuffer());
        const bytes = await pdf.save({ useObjectStreams: true });
        if (bytes.length < file.size) file = new File([bytes], file.name, { type: types.pdf });
      } catch {
        throw new Error('This PDF could not be compressed. Upload a PDF of 10 MB or less.');
      }
    }
    file = new File([file], file.name, { type: types[ext] });
  }
  if (file.size > MAX_UPLOAD_BYTES)
    throw new Error('The final file must be 10 MB or less. Compress it further before uploading.');
  return file;
}
