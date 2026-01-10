import { esc, qsa, qs } from "./dom.js";
import { copyText, flash, mkBtn } from "./clipboard.js";
import { replaceMathWithPlaceholders, setMathMetaForElement, fillMathSlots } from "./math.js";
import { getScrollStickiness, maybeScrollToBottom } from "./scroll.js";

const THINK_PATTERN = /<think>([\s\S]*?)<\/think>/g;

const captureThinkOpen = (container) =>
  qsa(container, "details.think-block").map((d) => d.open);

const splitThinkPlaceholders = (text = "") => {
  const think = [];
  const replaced = String(text ?? "").replace(THINK_PATTERN, (_, inner) => {
    think.push(inner);
    return `§§THINK${think.length - 1}§§`;
  });
  return { text: replaced, think };
};

const bodyEl = (msgEl) => qs(msgEl, ".msg-body") ?? msgEl;

export const decorate = (container) => {
  qsa(container, "pre > code").forEach((code) => {
    const pre = code.parentElement;
    if (!pre || pre.getAttribute("data-has-copy") === "1") return;
    if (pre.closest("details.think-block")) return;
    if (!pre.closest(".msg-body")) return;

    const wrap = document.createElement("div");
    wrap.className = "pre-wrap";
    pre.parentNode.insertBefore(wrap, pre);
    wrap.appendChild(pre);

    const btn = mkBtn({
      text: "Copy",
      title: "Copy code",
      cls: "copy-inline-btn",
      onClick: async () => flash(btn, await copyText(code.textContent ?? "")),
    });

    wrap.appendChild(btn);
    pre.setAttribute("data-has-copy", "1");
  });

  qsa(container, ".math-block-wrap").forEach((wrap) => {
    if (wrap.getAttribute("data-has-copy") === "1") return;
    if (!wrap.closest(".msg-body")) return;

    const tex = wrap.getAttribute("data-tex") ?? "";
    const btn = mkBtn({
      text: "Copy",
      title: "Copy LaTeX (content only)",
      cls: "copy-inline-btn",
      onClick: async () => flash(btn, await copyText(tex)),
    });

    wrap.appendChild(btn);
    wrap.setAttribute("data-has-copy", "1");
  });
};

export const renderMarkdownInto = (renderTarget, markdownText = "") => {
  const prevOpen = captureThinkOpen(renderTarget);

  const { text: noThink, think } = splitThinkPlaceholders(markdownText);

  const { text: noThinkOrMath, segments } = replaceMathWithPlaceholders(noThink);

  const safeHtml = window.DOMPurify.sanitize(
    window.marked.parse(noThinkOrMath, { breaks: true })
  );

  let html = safeHtml;

  setMathMetaForElement(renderTarget, segments);

  segments.forEach((seg, i) => {
    const ph = `§§MATH${i}§§`;
    const slot = seg.display
      ? `<div class="math-block-wrap" data-math-key="${esc(seg.key)}" data-tex="${esc(
        seg.tex
      )}"><div class="math-render"></div></div>`
      : `<span class="math-slot" data-math-key="${esc(seg.key)}"></span>`;
    html = html.split(ph).join(slot);
  });

  think.forEach((t, i) => {
    const ph = `§§THINK${i}§§`;
    const open = (prevOpen[i] ?? true) ? " open" : "";
    const block =
      `<details class="think-block"${open}>` +
      `<summary>Reasoning</summary>` +
      `<div class="think-content"><code>${esc(String(t ?? "").trim())}</code></div>` +
      `</details>`;
    html = html.split(ph).join(block);
  });

  renderTarget.innerHTML = html;
  fillMathSlots(renderTarget);
  decorate(renderTarget);
};

export const scheduleStreamingRender = ({ state, msgEl, text, scrollEl = null, thresholdPx = 180 }) => {
  state.pendingRender.el = msgEl;
  state.pendingRender.text = text;

  if (state.renderTimeoutId) return;

  const sticky = scrollEl ? getScrollStickiness(scrollEl, thresholdPx) : null;

  state.renderTimeoutId = setTimeout(() => {
    state.renderTimeoutId = null;
    const el = state.pendingRender.el;
    if (!el) return;

    renderMarkdownInto(bodyEl(el), state.pendingRender.text);

    if (scrollEl) maybeScrollToBottom(scrollEl, sticky);
  }, 60);
};
