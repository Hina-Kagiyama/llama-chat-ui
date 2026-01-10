// assets/js/markdown.js
//
// Markdown rendering pipeline:
// - Extract <think ...>...</think> blocks into collapsible "Reasoning" details
// - Extract <tool ...>...</tool> blocks into collapsible "Tool" details
// - Replace math segments with placeholders and render via MathJax (SVG) with caching
// - Sanitize marked output with DOMPurify
// - Add inline copy buttons for code blocks and display-math blocks
// - Provide a throttled streaming renderer

import { esc, qsa, qs } from "./dom.js";
import { copyText, flash, mkBtn } from "./clipboard.js";
import { replaceMathWithPlaceholders, setMathMetaForElement, fillMathSlots } from "./math.js";

/* ---------- patterns ---------- */
const THINK_PATTERN = /<think\b([^>]*)>([\s\S]*?)<\/think>/g;
const TOOL_PATTERN = /<tool\b([^>]*)>([\s\S]*?)<\/tool>/g;

/* ---------- helpers ---------- */
const bodyEl = (msgEl) => qs(msgEl, ".msg-body") ?? msgEl;

const captureThinkOpen = (container) =>
  qsa(container, "details.think-block").map((d) => d.open);

const parseAttrs = (attrs = "") => {
  const get = (k) => {
    const m = String(attrs).match(new RegExp(`\\b${k}="([^"]*)"`, "i"));
    return m ? m[1] : null;
  };
  return {
    id: get("id"),
    state: get("state"), // "live" | "done" | null
    name: get("name"),
  };
};

const splitThinkPlaceholders = (text = "") => {
  const think = [];
  const replaced = String(text ?? "").replace(THINK_PATTERN, (_, attrs, inner) => {
    const meta = parseAttrs(attrs);
    think.push({ inner: inner ?? "", id: meta.id, state: meta.state });
    return `§§THINK${think.length - 1}§§`;
  });
  return { text: replaced, think };
};

const splitToolPlaceholders = (text = "") => {
  const tools = [];
  const replaced = String(text ?? "").replace(TOOL_PATTERN, (_, attrs, inner) => {
    const meta = parseAttrs(attrs);
    tools.push({
      inner: inner ?? "",
      id: meta.id,
      state: meta.state,
      name: meta.name || "tool",
    });
    return `§§TOOL${tools.length - 1}§§`;
  });
  return { text: replaced, tools };
};

/* ---------- decorate (copy buttons) ---------- */
export const decorate = (container) => {
  // Code: pre > code only inside .msg-body, exclude think-block/tool-block, add once
  qsa(container, "pre > code").forEach((code) => {
    const pre = code.parentElement;
    if (!pre || pre.getAttribute("data-has-copy") === "1") return;
    if (pre.closest("details.think-block")) return;
    if (pre.closest("details.tool-block")) return;
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

  // Display math blocks we created: copy TeX content only (no $$)
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

  // Tool pane copy buttons (Input/Output)
  qsa(container, "button.tool-pane-copy").forEach((btn) => {
    if (btn.getAttribute("data-wired") === "1") return;
    btn.setAttribute("data-wired", "1");
    btn.addEventListener("click", async () => {
      const txt = btn.getAttribute("data-copy") ?? "";
      flash(btn, await copyText(txt), { okText: "Copied", failText: txt ? "Failed" : "No content" });
    });
  });
};

/* ---------- render ---------- */
export const renderMarkdownInto = (renderTarget, markdownText = "") => {
  const prevOpen = captureThinkOpen(renderTarget);

  // 1) Extract <think ...>...</think>
  const { text: noThink, think } = splitThinkPlaceholders(markdownText);

  // 2) Extract <tool ...>...</tool>
  const { text: noThinkOrTool, tools } = splitToolPlaceholders(noThink);

  // 3) Replace math with placeholders
  const { text: noThinkToolOrMath, segments } = replaceMathWithPlaceholders(noThinkOrTool);

  // 4) Markdown -> sanitize
  const safeHtml = window.DOMPurify.sanitize(
    window.marked.parse(noThinkToolOrMath, { breaks: true })
  );
  let html = safeHtml;

  // 5) Swap math placeholders -> slots + store meta
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

  // 6) Swap tool placeholders -> details blocks (open if not done)
  tools.forEach((t, i) => {
    const ph = `§§TOOL${i}§§`;
    const state = (t.state || "live").toLowerCase();
    const open = state === "done" ? "" : " open";
    const idAttr = t.id ? ` data-block-id="${esc(t.id)}"` : "";
    const stateAttr = ` data-state="${esc(state)}"`;
    const raw = String(t.inner ?? "").trim();

    // Expecting the inner text produced by send.js:
    // INPUT:\n...\n\nOUTPUT:\n...
    // We split robustly but fall back to the raw whole text if not matched.
    let inputText = "";
    let outputText = "";
    const m = raw.match(/^\s*INPUT:\s*\n([\s\S]*?)\n\s*\nOUTPUT:\s*\n([\s\S]*?)\s*$/i);
    if (m) {
      inputText = (m[1] ?? "").trim();
      outputText = (m[2] ?? "").trim();
    } else {
      // fallback: treat everything as output
      outputText = raw;
    }

    const block =
      `<details class="tool-block"${open}${idAttr}${stateAttr}>` +
      `<summary>Tool: ${esc(t.name)}</summary>` +
      `<div class="tool-content">` +
      `<div class="tool-io">` +
      `<div class="tool-pane" data-pane="input">` +
      `<div class="tool-pane-head">` +
      `<span class="tool-pane-title">Input</span>` +
      `<button type="button" class="tool-pane-copy" data-copy="${esc(inputText)}">Copy</button>` +
      `</div>` +
      `<pre class="tool-pane-body"><code>${esc(inputText)}</code></pre>` +
      `</div>` +
      `<div class="tool-pane" data-pane="output">` +
      `<div class="tool-pane-head">` +
      `<span class="tool-pane-title">Output</span>` +
      `<button type="button" class="tool-pane-copy" data-copy="${esc(outputText)}">Copy</button>` +
      `</div>` +
      `<pre class="tool-pane-body"><code>${esc(outputText)}</code></pre>` +
      `</div>` +
      `</div>` +
      `</div>` +
      `</details>`;
    html = html.split(ph).join(block);
  });

  // 7) Swap think placeholders -> details blocks
  // Preserve prior open/close only for blocks that had no explicit state;
  // otherwise state controls open/close.
  think.forEach((t, i) => {
    const ph = `§§THINK${i}§§`;
    const state = (t.state || "").toLowerCase();
    const hasExplicitState = !!state;

    const open =
      hasExplicitState
        ? (state === "done" ? "" : " open")
        : ((prevOpen[i] ?? true) ? " open" : "");

    const idAttr = t.id ? ` data-block-id="${esc(t.id)}"` : "";
    const stateAttr = hasExplicitState ? ` data-state="${esc(state)}"` : "";

    const block =
      `<details class="think-block"${open}${idAttr}${stateAttr}>` +
      `<summary>Reasoning</summary>` +
      `<div class="think-content"><code>${esc(String(t.inner ?? "").trim())}</code></div>` +
      `</details>`;
    html = html.split(ph).join(block);
  });

  renderTarget.innerHTML = html;
  fillMathSlots(renderTarget);
  decorate(renderTarget);
};

/* ---------- streaming render throttle ---------- */
export const scheduleStreamingRender = ({ state, msgEl, text, scrollEl = null, thresholdPx = 180 }) => {
  state.pendingRender.el = msgEl;
  state.pendingRender.text = text;

  if (state.renderTimeoutId) return;

  state.renderTimeoutId = setTimeout(() => {
    state.renderTimeoutId = null;
    const el = state.pendingRender.el;
    if (!el) return;

    renderMarkdownInto(bodyEl(el), state.pendingRender.text);

    // Optional sticky scroll behavior (if you’ve implemented it)
    if (scrollEl) {
      const distance = scrollEl.scrollHeight - (scrollEl.scrollTop + scrollEl.clientHeight);
      if (distance <= thresholdPx) scrollEl.scrollTop = scrollEl.scrollHeight;
    }
  }, 60);
};
