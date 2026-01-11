import { setStatus, setTokens, resetHeadline } from "./headline.js";

const modelsUrlFromEndpoint = (ep = "") => {
  ep = String(ep ?? "").trim();
  if (!ep) return null;

  const i = ep.indexOf("/v1");
  if (i !== -1) return ep.slice(0, i + 3) + "/models";

  try { return `${new URL(ep).origin}/v1/models`; } catch { return null; }
};

const pickDefaultModel = (models = []) => {
  const ids = (models || []).map((m) => m?.id).filter(Boolean);
  return ids.find((id) => /llama/i.test(id)) ?? ids[0] ?? null;
};

const ctxFromModelObj = (m) =>
  [
    m?.context_length,
    m?.max_context_length,
    m?.max_context_tokens,
    m?.n_ctx,
    m?.ctx,
    m?.meta?.n_ctx,
    m?.meta?.context_length,
    m?.meta?.max_context_length,
    m?.meta?.max_context_tokens,
  ].find((v) => Number.isFinite(v) && v > 0) ?? null;

export const setModelInputEnabled = ({ state, refs }) => {
  const auto = !!refs?.autoModelEl?.checked;
  const modelEl = refs?.modelEl;
  if (!modelEl) return;

  modelEl.disabled = auto;
  modelEl.placeholder = auto ? "(auto)" : "enter model id";

  if (auto && !String(modelEl.value ?? "").trim()) {
    const chosen = pickDefaultModel(state.lastModels);
    if (chosen) modelEl.value = chosen;
  }
};

export const fetchModels = async ({ state, refs }) => {
  if (state.modelsFetchInFlight) return state.modelsFetchInFlight;

  const endpoint = refs?.endpointEl?.value ?? "";
  const url = modelsUrlFromEndpoint(endpoint);

  if (!url) {
    setStatus({ refs }, "Models: invalid endpoint");
    return null;
  }

  state.modelsFetchInFlight = (async () => {
    try {
      setStatus({ refs }, "Fetching models…");

      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} – ${res.statusText}`);

      const json = await res.json();
      const models = Array.isArray(json?.data) ? json.data : [];

      state.lastModels = models;

      const chosen = pickDefaultModel(models);

      if (refs?.autoModelEl?.checked && chosen && refs?.modelEl) {
        refs.modelEl.value = chosen;
        refs.modelEl.placeholder = "(auto)";
      }

      const currentId = String(refs?.modelEl?.value ?? "").trim();
      const obj = models.find((m) => m?.id === currentId) ?? models[0] ?? null;

      const maybeCtx = obj ? ctxFromModelObj(obj) : null;
      if (typeof maybeCtx === "number") state.ctxSize = maybeCtx;

      if (state.lastUsage?.total_tokens) setTokens({ state, refs }, state.lastUsage);
      else resetHeadline({ state, refs });

      setStatus({ refs }, chosen ? `Models: ${models.length} found` : "Models: none");
      return models;
    } catch (e) {
      console.error(e);
      setStatus({ refs }, "Models: fetch failed (CORS?)");
      return null;
    } finally {
      state.modelsFetchInFlight = null;
    }
  })();

  return state.modelsFetchInFlight;
};
