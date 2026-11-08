/** Where an installed copy runs, for the install count. */
export function devicePlatform(
  agent = navigator.userAgent,
  touchPoints = navigator.maxTouchPoints,
) {
  const ua = agent.toLowerCase();
  if (/android/.test(ua)) return 'android';
  if (/iphone|ipad|ipod/.test(ua) || (/macintosh/.test(ua) && touchPoints > 1)) return 'ios';
  if (/windows/.test(ua)) return 'windows';
  if (/macintosh|mac os x/.test(ua)) return 'macos';
  if (/linux|cros/.test(ua)) return 'linux';
  return 'other';
}
const isInstalled = () =>
  matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
function deviceId() {
  let id = localStorage.getItem('hoora-device-id');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id || '')) {
    id = crypto.randomUUID();
    localStorage.setItem('hoora-device-id', id);
  }
  return id;
}
export function pwaFeature({ appApi, getToken, toast }) {
  let installPrompt;
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event;
    document.querySelectorAll('[data-install-app]').forEach((b) => (b.hidden = false));
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    window.dispatchEvent(new CustomEvent('hoora-app-installed'));
  });
  async function install() {
    if (installPrompt) {
      const prompt = installPrompt;
      installPrompt = null;
      await prompt.prompt();
      const choice = await prompt.userChoice;
      return choice?.outcome === 'accepted';
    }
    const ua = navigator.userAgent.toLowerCase();
    if (/iphone|ipad|ipod/.test(ua) && !window.MSStream)
      toast('In Safari, tap Share, then Add to Home Screen.');
    else toast('Choose Install app or Add to Home Screen in your browser menu.');
    return false;
  }
  async function registration() {
    if (!('serviceWorker' in navigator))
      throw Error('This browser does not support app notifications.');
    return navigator.serviceWorker.register('/sw.js');
  }
  async function enable() {
    if (!('PushManager' in window) || !('Notification' in window))
      throw Error(
        'Browser notifications are unavailable. On iPhone, install Hoora Docs on the Home Screen first.',
      );
    const permission = await Notification.requestPermission();
    if (permission !== 'granted')
      throw Error('Enable notifications in your browser settings to receive updates.');
    const token = await getToken();
    const response = await fetch('/api/push', { headers: { Authorization: 'Bearer ' + token } });
    const data = await response.json();
    if (!response.ok || !data.publicKey)
      throw Error(data.error || 'Browser notifications are not configured.');
    const reg = await registration();
    await navigator.serviceWorker.ready;
    const bytes = Uint8Array.from(atob(data.publicKey.replace(/-/g, '+').replace(/_/g, '/')), (c) =>
      c.charCodeAt(0),
    );
    const subscription =
      (await reg.pushManager.getSubscription()) ||
      (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes }));
    await appApi('/api/push', { action: 'subscribe', subscription: subscription.toJSON() });
    toast('Browser notifications enabled for this account.');
  }
  async function disconnect() {
    const reg = await registration();
    const subscription = await reg.pushManager.getSubscription();
    if (subscription) {
      await appApi('/api/push', { action: 'unsubscribe', endpoint: subscription.endpoint });
      await subscription.unsubscribe();
    }
  }
  async function disable() {
    await disconnect();
    toast('Browser notifications disabled.');
  }
  /** Count this device as an installed app. */
  async function recordInstall() {
    await appApi('/api/push', {
      action: 'device',
      deviceId: deviceId(),
      platform: devicePlatform(),
    });
  }
  /**
   * Once a day per account: an installed copy confirms it is still in use, and this
   * browser's notification subscription is refreshed, or removed if permission was revoked.
   * Devices that stop opening Hoora Docs leave the counts after 30 days.
   */
  async function sync(memberId) {
    const key = `hoora-device-sync:${memberId}`;
    const today = new Date().toISOString().slice(0, 10);
    try {
      if (localStorage.getItem(key) === today) return;
      if (isInstalled()) await recordInstall();
      if ('Notification' in window && 'serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration('/');
        const subscription = await reg?.pushManager?.getSubscription();
        if (subscription && Notification.permission === 'granted')
          await appApi('/api/push', { action: 'subscribe', subscription: subscription.toJSON() });
        else if (subscription) {
          await appApi('/api/push', { action: 'unsubscribe', endpoint: subscription.endpoint });
          await subscription.unsubscribe();
        }
      }
      localStorage.setItem(key, today);
    } catch {
      /* Counting is best effort and retried on the next visit. */
    }
  }
  /** Administrators: installed apps and notification devices in use. */
  async function deviceStats() {
    const response = await fetch('/api/push?stats=1', {
      headers: { Authorization: 'Bearer ' + (await getToken()) },
    });
    const data = await response.json();
    if (!response.ok) throw Error(data.error || 'Unable to load device counts.');
    return data;
  }
  async function status() {
    const supported =
      'Notification' in window && 'PushManager' in window && 'serviceWorker' in navigator;
    const installed = isInstalled();
    if (!supported)
      return { supported: false, installed, permission: 'unsupported', subscribed: false };
    let subscribed = false;
    try {
      const reg = await navigator.serviceWorker.getRegistration('/');
      subscribed = Boolean(await reg?.pushManager?.getSubscription());
    } catch {
      /* The settings page can still explain unsupported browser permission. */
    }
    return { supported: true, installed, permission: Notification.permission, subscribed };
  }
  registration().catch(() => {});
  return { install, enable, disable, disconnect, status, sync, recordInstall, deviceStats };
}
