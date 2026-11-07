/** The supplied Vehicle 360 letter sweep, without the progress line or rotating copy. */
export function createLoading({ app, element }) {
  let tasks = 0,
    delay,
    visibleAt = 0,
    generation = 0,
    frame = 0;
  const reduced = matchMedia('(prefers-reduced-motion:reduce)');
  function hide() {
    cancelAnimationFrame(frame);
    visibleAt = 0;
    element.hidden = true;
    element.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('vehicle-loading');
    app.inert = false;
    app.setAttribute('aria-busy', 'false');
  }
  function show() {
    if (!element || visibleAt) return;
    const word = element.querySelector('.vehicle-loader-word'),
      letters = [];
    word.replaceChildren(
      ...Array.from('Smart Vehicle 360', (character) => {
        const span = document.createElement('span');
        span.className = character === ' ' ? 'vehicle-loader-gap' : 'vehicle-loader-letter';
        span.textContent = character;
        span.setAttribute('aria-hidden', 'true');
        if (character !== ' ') letters.push(span);
        return span;
      }),
    );
    element.hidden = false;
    element.setAttribute('aria-hidden', 'false');
    visibleAt = performance.now();
    document.body.classList.add('vehicle-loading');
    app.inert = true;
    app.setAttribute('aria-busy', 'true');
    const animate = (now) => {
      const progress = Math.min(1, ((now - visibleAt) % 1750) / 1500),
        light = progress < 0.5 ? 2 * progress * progress : 1 - (-2 * progress + 2) ** 2 / 2;
      letters.forEach((letter, index) => {
        const glow = reduced.matches
          ? 1
          : Math.max(
              0,
              1 - Math.abs(light - (0.12 + (0.76 * index) / (letters.length - 1))) / 0.16,
            );
        letter.style.opacity = String(0.32 + 0.68 * glow);
        letter.style.transform = reduced.matches ? 'none' : `translateY(${-1.5 * glow}px)`;
      });
      if (!reduced.matches) frame = requestAnimationFrame(animate);
    };
    animate(visibleAt);
  }
  async function during(work) {
    tasks++;
    generation++;
    if (tasks === 1 && !visibleAt)
      delay = setTimeout(() => {
        if (tasks) show();
      }, 600);
    try {
      return await work();
    } finally {
      tasks = Math.max(0, tasks - 1);
      if (!tasks) {
        clearTimeout(delay);
        const current = ++generation;
        if (visibleAt)
          setTimeout(
            () => {
              if (!tasks && generation === current) hide();
            },
            Math.max(0, 250 - (performance.now() - visibleAt)),
          );
        else app.setAttribute('aria-busy', 'false');
      }
    }
  }
  return { during };
}
