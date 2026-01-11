import { qsa } from "./dom.js";

const COMPLETE_MATH_PATTERN =
  /\$\$[\s\S]*?\$\$|\$[^$\n]*\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)/g;

const mathMetaByElement = new WeakMap(); // element -> Map(key -> {raw, tex, display, key})
const mathSvgCache = new Map();          // key -> rendered SVG outerHTML
const mathInflight = new Map();          // key -> Promise(html|null)

const hashDjb2 = (s) => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return (h >>> 0).toString(16);
};

const normalizeMath = (raw = "") => {
  if (raw.startsWith("$$") && raw.endsWith("$$")) return { tex: raw.slice(2, -2), display: true };
  if (raw.startsWith("$") && raw.endsWith("$")) return { tex: raw.slice(1, -1), display: false };
  if (raw.startsWith("\\[") && raw.endsWith("\\]")) return { tex: raw.slice(2, -2), display: true };
  if (raw.startsWith("\\(") && raw.endsWith("\\)")) return { tex: raw.slice(2, -2), display: false };
  return { tex: raw, display: false };
};

export const replaceMathWithPlaceholders = (text = "") => {
  const segments = [];
  const replaced = String(text ?? "").replace(COMPLETE_MATH_PATTERN, (match) => {
    const { tex, display } = normalizeMath(match);
    const key = `m_${display ? "D" : "I"}_${hashDjb2(match)}`;
    segments.push({ key, raw: match, tex, display });
    return `§§MATH${segments.length - 1}§§`;
  });
  return { text: replaced, segments };
};

export const setMathMetaForElement = (el, segments = []) => {
  const meta = new Map();
  for (const seg of segments) meta.set(seg.key, seg);
  mathMetaByElement.set(el, meta);
  return meta;
};

export const fillMathSlots = (container) => {
  const meta = mathMetaByElement.get(container);
  if (!meta) return;

  const slots = qsa(container, "[data-math-key]");
  if (!slots.length) return;

  const setRender = (slot, html, fallback) => {
    const target = slot.classList.contains("math-block-wrap")
      ? (slot.querySelector(".math-render") ?? slot)
      : slot;

    if (html) target.innerHTML = html;
    else target.textContent = fallback ?? "";
  };

  // Paint cached (or fallback raw) immediately
  for (const slot of slots) {
    const key = slot.getAttribute("data-math-key");
    const cached = key ? mathSvgCache.get(key) : null;
    if (cached) setRender(slot, cached, "");
    else setRender(slot, null, key ? (meta.get(key)?.raw ?? "") : "");
  }

  // Kick off render for uncached keys
  for (const slot of slots) {
    const key = slot.getAttribute("data-math-key");
    if (!key || mathSvgCache.has(key)) continue;

    const seg = meta.get(key);
    if (!seg) continue;

    if (!mathInflight.has(key)) {
      const p = (async () => {
        const MJ = window.MathJax;
        if (!MJ?.tex2svgPromise) return null;

        const svgEl = await MJ.tex2svgPromise(seg.tex, { display: seg.display });
        const html = svgEl?.outerHTML ?? null;
        if (html) mathSvgCache.set(key, html);
        return html;
      })().finally(() => {
        mathInflight.delete(key);
      });

      mathInflight.set(key, p);
    }

    mathInflight
      .get(key)
      .then((html) => {
        if (!html) return;
        // Update all slots with the same key within this container
        const escKey = CSS.escape(key);
        qsa(container, `[data-math-key="${escKey}"]`).forEach((s) => {
          const target = s.classList.contains("math-block-wrap")
            ? (s.querySelector(".math-render") ?? s)
            : s;
          target.innerHTML = html;
        });
      })
      .catch(() => {
        /* impossible */
      });
  }
};
