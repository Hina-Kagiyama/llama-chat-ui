// assets/js/layout.js
//
// Maintains the fixed header/footer layout by sizing the chat viewport area.
// Mirrors behavior from the original single-file implementation.

export const updateLayout = (headerEl, footerEl, chatEl) => {
  if (!chatEl) return;
  const top = headerEl?.offsetHeight ?? 0;
  const bottom = footerEl?.offsetHeight ?? 0;
  chatEl.style.top = `${top}px`;
  chatEl.style.bottom = `${bottom}px`;
};

// Optional helper: keep layout synced when header/footer height changes (wraps ResizeObserver).
export const installResizeObservers = ({ headerEl, footerEl, onResize }) => {
  if (typeof ResizeObserver === "undefined") return null;

  const cb = () => {
    try {
      onResize?.();
    } catch {
      // no-op: layout shouldn't hard-fail
    }
  };

  const ro = new ResizeObserver(cb);

  if (headerEl) ro.observe(headerEl);
  if (footerEl) ro.observe(footerEl);

  return ro;
};
