export const $ = (id) => document.getElementById(id);
export const on = (el, ev, fn, opts) => el?.addEventListener(ev, fn, opts);
export const qs = (el, selector) => el?.querySelector(selector) ?? null;
export const qsa = (el, selector) => [...(el?.querySelectorAll(selector) ?? [])];
export const now = () => (performance?.now?.() ?? Date.now());
export const fmt1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : "—");
export const esc = (s = "") =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
export const humanKB = (b = 0) => `${Math.max(1, Math.round(Number(b || 0) / 1024))} KB`;
