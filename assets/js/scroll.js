export const getScrollStickiness = (scrollEl, thresholdPx = 180) => {
  if (!scrollEl) return { stick: false, thresholdPx };
  const distance = scrollEl.scrollHeight - (scrollEl.scrollTop + scrollEl.clientHeight);
  return { stick: distance <= thresholdPx, thresholdPx };
};

export const scrollToBottom = (scrollEl) => {
  if (!scrollEl) return;
  scrollEl.scrollTop = scrollEl.scrollHeight;
};

export const maybeScrollToBottom = (scrollEl, stickiness) => {
  if (!scrollEl) return;
  if (stickiness?.stick) scrollToBottom(scrollEl);
};

export const withStickyScroll = (scrollEl, fn, thresholdPx = 180) => {
  const s = getScrollStickiness(scrollEl, thresholdPx);
  const out = fn?.();
  maybeScrollToBottom(scrollEl, s);
  return out;
};

