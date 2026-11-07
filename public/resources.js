/** Provider metadata only. URLs never trigger a server-side fetch. */
export function describeResource(value) {
  try {
    const u = new URL(String(value).trim());
    if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password) return null;
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    let videoId = null;
    if (host === 'youtu.be') videoId = u.pathname.split('/')[1];
    if (['youtube.com', 'm.youtube.com', 'youtube-nocookie.com'].includes(host))
      videoId = u.searchParams.get('v') || u.pathname.match(/^\/(?:embed|shorts)\/([\w-]+)/)?.[1];
    if (videoId && !/^[\w-]{11}$/.test(videoId)) videoId = null;
    return { url: u.href, host, title: videoId ? 'YouTube video' : host, videoId };
  } catch {
    return null;
  }
}
