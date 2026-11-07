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
  registration().catch(() => {});
  return { install, enable, disable, disconnect };
}
