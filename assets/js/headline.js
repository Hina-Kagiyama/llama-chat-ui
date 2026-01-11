import { fmt1, now } from "./dom.js";

export const setStatus = ({ refs }, text) => {
  if (refs?.statusEl) refs.statusEl.textContent = String(text ?? "");
};

export const setTokens = ({ state, refs }, usage) => {
  state.lastUsage = usage ?? null;

  const el = refs?.tokensEl;
  if (!el) return;

  const ctxSize = state.ctxSize;

  if (!usage || typeof usage.total_tokens !== "number") {
    el.textContent = typeof ctxSize === "number" && ctxSize > 0 ? `Tokens: — (ctx ${ctxSize})` : "Tokens: —";
    return;
  }

  const p = typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : null;
  const c = typeof usage.completion_tokens === "number" ? usage.completion_tokens : null;
  const t = usage.total_tokens;

  const parts = [
    p !== null ? `prompt ${p}` : null,
    c !== null ? `completion ${c}` : null,
    `total ${t}`,
  ].filter(Boolean);

  if (typeof ctxSize === "number" && ctxSize > 0) {
    parts.push(`remain ${Math.max(ctxSize - t, 0)}`);
    el.textContent = `Tokens: ${parts.join(" | ")} (ctx ${ctxSize})`;
  } else {
    el.textContent = `Tokens: ${parts.join(" | ")}`;
  }
};

export const setSpeed = ({ refs }, chps, tkps) => {
  const el = refs?.speedEl;
  if (!el) return;

  const cs = Number.isFinite(chps) ? `${fmt1(chps)} ch/s` : "—";
  const ts = Number.isFinite(tkps) ? `${fmt1(tkps)} tok/s` : "—";
  el.textContent = `Speed: ${cs} | ${ts}`;
};

export const resetHeadline = ({ state, refs }) => {
  setTokens({ state, refs }, null);
  if (refs?.speedEl) refs.speedEl.textContent = "Speed: —";
};

export const stopHeadline = ({ state }) => {
  if (state.headlineTimerId) {
    clearInterval(state.headlineTimerId);
    state.headlineTimerId = null;
  }
};

export const paintHeadline = ({ state, refs }, force = false) => {
  const liveStats = state.liveStats;
  if (!liveStats) return;

  const t = now();
  if (!force && (t - (state.lastHeadlinePaintTs || 0)) < 150) return;
  state.lastHeadlinePaintTs = t;

  const elapsed = Math.max((t - liveStats.startTs) / 1000, 0.001);
  const chps = liveStats.completionChars / elapsed;

  const lastUsage = state.lastUsage;
  const tkps =
    lastUsage && typeof lastUsage.completion_tokens === "number"
      ? (lastUsage.completion_tokens / elapsed)
      : NaN;

  setSpeed({ refs }, chps, tkps);
};

export const startHeadline = ({ state, refs }) => {
  stopHeadline({ state });
  state.headlineTimerId = setInterval(() => paintHeadline({ state, refs }, false), 200);
};
