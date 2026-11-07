/**
 * Smart Vehicle 360 loader: only the letter sweep from the Hoora loader pack.
 * Shown only when work is still running after 600 ms; once shown it stays at
 * least 1.2 s so it never flashes. Fades in over 200 ms and out over 260 ms.
 */
const WORD = 'Smart Vehicle 360';
const SHOW_AFTER = 600,
  MIN_VISIBLE = 1200,
  FADE_OUT = 260,
  SWEEP = 1500,
  REST = 250;

export function createLoading({ app, element }) {
  let tasks = 0,
    delay,
    hideTimer,
    visibleAt = 0,
    frame = 0;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const word = element?.querySelector('.vehicle-loader-word');
  // Every character, including spaces, takes a position along the sweep.
  const characters = word
    ? Array.from(WORD, (character, index) => {
        const span = document.createElement('span');
        span.textContent = character;
        span.className =
          character === ' '
            ? 'vehicle-loader-gap'
            : index >= WORD.lastIndexOf(' ') + 1
              ? 'vehicle-loader-letter is-number'
              : 'vehicle-loader-letter';
        return span;
      })
    : [];
  word?.replaceChildren(...characters);
  const last = characters.length - 1;

  function paint(now) {
    const cycle = (now - visibleAt) % (SWEEP + REST);
    const t = Math.min(1, cycle / SWEEP);
    const light = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2; // ease-in-out quad
    // The light is a brightness change; with reduced motion the letters only skip the lift.
    characters.forEach((span, index) => {
      if (span.classList.contains('vehicle-loader-gap')) return;
      const glow = Math.max(0, 1 - Math.abs(light - (0.12 + (0.76 * index) / last)) / 0.16);
      span.style.opacity = String(0.32 + 0.68 * glow);
      span.style.transform = reduced.matches ? 'none' : `translateY(${-1.5 * glow}px)`;
    });
    frame = requestAnimationFrame(paint);
  }
  function show() {
    if (!element || visibleAt) return;
    clearTimeout(hideTimer);
    visibleAt = performance.now();
    element.hidden = false;
    element.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => element.classList.add('is-visible'));
    document.body.classList.add('vehicle-loading');
    app.inert = true;
    paint(visibleAt);
  }
  function hide() {
    if (!visibleAt) return;
    visibleAt = 0;
    element.classList.remove('is-visible');
    document.body.classList.remove('vehicle-loading');
    app.inert = false;
    hideTimer = setTimeout(() => {
      cancelAnimationFrame(frame);
      element.hidden = true;
      element.setAttribute('aria-hidden', 'true');
    }, FADE_OUT);
  }
  async function during(work) {
    tasks++;
    app.setAttribute('aria-busy', 'true');
    if (tasks === 1 && !visibleAt) delay = setTimeout(() => tasks && show(), SHOW_AFTER);
    try {
      return await work();
    } finally {
      tasks = Math.max(0, tasks - 1);
      if (!tasks) {
        clearTimeout(delay);
        app.setAttribute('aria-busy', 'false');
        if (visibleAt)
          setTimeout(
            () => !tasks && hide(),
            Math.max(0, MIN_VISIBLE - (performance.now() - visibleAt)),
          );
      }
    }
  }
  return { during };
}
