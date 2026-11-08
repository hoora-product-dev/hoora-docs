try {
  document.documentElement.dataset.theme = localStorage.getItem('hoora-theme') || 'dark';
} catch {
  document.documentElement.dataset.theme = 'dark';
}
// iPhone and iPad zoom the page when a field is focused. A maximum scale stops that
// automatic zoom; iOS still lets people pinch to zoom. Other platforms do not
// auto-zoom, so their viewport is left alone and pinch zoom stays unrestricted.
if (
  /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
) {
  document
    .querySelector('meta[name="viewport"]')
    ?.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1');
}
