import { describeResource } from '../resources.js';
export function bindResourcePreviews() {
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-load-video]');
    if (!button) return;
    const resource = describeResource(button.dataset.loadVideo);
    if (!resource?.videoId) return;
    const iframe = document.createElement('iframe');
    iframe.src = 'https://www.youtube-nocookie.com/embed/' + resource.videoId;
    iframe.title = 'YouTube video';
    iframe.loading = 'lazy';
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    iframe.allow = 'accelerometer; encrypted-media; gyroscope; picture-in-picture';
    iframe.allowFullscreen = true;
    button.closest('.resource-preview').replaceChildren(iframe);
  });
}
