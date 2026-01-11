export const updateLayout = (headerEl, footerEl, chatEl) => {
  if (!chatEl) return;
  const top = headerEl?.offsetHeight ?? 0;
  const bottom = footerEl?.offsetHeight ?? 0;
  chatEl.style.top = `${top}px`;
  chatEl.style.bottom = `${bottom}px`;
};

export const installResizeObservers = ({ headerEl, footerEl, onResize }) => {
  if (typeof ResizeObserver === "undefined") return null;

  const cb = () => {
    try {
      onResize?.();
    } catch {
      // layout shouldn't hard-fail
    }
  };

  const ro = new ResizeObserver(cb);

  if (headerEl) ro.observe(headerEl);
  if (footerEl) ro.observe(footerEl);

  return ro;
};
