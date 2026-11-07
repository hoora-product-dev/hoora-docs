/** Shared non-blocking feedback. Message content is always treated as text. */
export function createFeedback(root = document) {
  let timer;
  function toast(message, error = false) {
    const host = root.querySelector('#toast');
    if (!host) return;
    clearTimeout(timer);
    host.replaceChildren();
    host.className = 'show' + (error ? ' error-toast' : '');
    host.setAttribute('role', error ? 'alert' : 'status');
    host.setAttribute('aria-live', error ? 'assertive' : 'polite');
    const text = document.createElement('span');
    text.textContent = String(message || '');
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'toast-close';
    close.setAttribute('aria-label', 'Dismiss notification');
    close.textContent = '×';
    const dismiss = () => {
      host.className = '';
      clearTimeout(timer);
    };
    close.addEventListener('click', dismiss);
    host.append(text, close);
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(dismiss, error ? 10000 : 5500);
    };
    host.onpointerenter = () => clearTimeout(timer);
    host.onpointerleave = schedule;
    host.onfocusin = () => clearTimeout(timer);
    host.onfocusout = schedule;
    schedule();
  }
  async function busy(button, work, onError) {
    const wasDisabled = button?.disabled;
    if (button) {
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      button.dataset.busy = 'true';
    }
    try {
      return await work();
    } catch (error) {
      onError?.(error);
    } finally {
      if (button?.isConnected) {
        button.disabled = wasDisabled || false;
        button.removeAttribute('aria-busy');
        delete button.dataset.busy;
      }
    }
  }
  return { toast, busy };
}
