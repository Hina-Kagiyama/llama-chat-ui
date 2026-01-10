import { qs, qsa } from "./dom.js";
import { withStickyScroll } from "./scroll.js";
import { mkBtn, copyText, flash } from "./clipboard.js";
import { renderMarkdownInto } from "./markdown.js";
import { userDisplayFromPayload } from "./persistence.js";

const bodyEl = (msgEl) => qs(msgEl, ".msg-body") ?? msgEl;

export const clearChatUi = ({ refs }) => {
  if (refs?.chatEl) refs.chatEl.innerHTML = "";
};

export const buildCombinedForRender = ({ includeReasoning }, reasoning = "", content = "") => {
  const inc = !!includeReasoning;
  if (!inc || !reasoning) return content ?? "";
  return content ? `<think>${reasoning}</think>\n\n${content}` : `<think>${reasoning}</think>`;
};

export const appendUserMessage = ({ refs }, md) => {
  return withStickyScroll(refs.chatEl, () => {
    const msg = document.createElement("div");
    msg.classList.add("message", "user");

    const body = document.createElement("div");
    body.className = "msg-body";
    msg.appendChild(body);

    renderMarkdownInto(body, md);

    refs.chatEl.appendChild(msg);
    return msg;
  });
};

export const updateFooterCopyEnabled = (msgEl) => {
  const cot = (msgEl.getAttribute("data-raw-cot") ?? "").trim();
  const ans = (msgEl.getAttribute("data-raw-answer") ?? "").trim();
  const cotBtn = qs(msgEl, "button.copy-cot");
  const ansBtn = qs(msgEl, "button.copy-answer");
  if (cotBtn) cotBtn.disabled = !cot;
  if (ansBtn) ansBtn.disabled = !ans;
};

const mkFooterCopy = ({ msgEl, cls, label, title, getText }) => {
  const b = mkBtn({
    text: label,
    title,
    cls,
    onClick: async () => {
      const txt = String(getText?.() ?? "").trim();
      const ok = txt ? await copyText(txt) : false;
      flash(b, ok, { failText: txt ? "Failed" : "No content" });
      setTimeout(() => updateFooterCopyEnabled(msgEl), 910);
    },
  });
  b.disabled = true;
  return b;
};

export const createAssistantMessageElement = ({ refs }) => {
  return withStickyScroll(refs.chatEl, () => {
    const msg = document.createElement("div");
    msg.classList.add("message", "assistant");

    const body = document.createElement("div");
    body.className = "msg-body";
    msg.appendChild(body);

    const footer = document.createElement("div");
    footer.className = "assistant-footer";

    const answered = document.createElement("span");
    answered.className = "answer-marker";
    footer.appendChild(answered);

    const group = document.createElement("div");
    group.className = "copy-buttons";

    group.appendChild(
      mkFooterCopy({
        msgEl: msg,
        cls: "copy-cot",
        label: "Copy CoT",
        title: "Copy raw reasoning (chain-of-thought)",
        getText: () => msg.getAttribute("data-raw-cot") ?? "",
      })
    );

    group.appendChild(
      mkFooterCopy({
        msgEl: msg,
        cls: "copy-answer",
        label: "Copy Answer",
        title: "Copy raw answer text",
        getText: () => msg.getAttribute("data-raw-answer") ?? "",
      })
    );

    footer.appendChild(group);
    msg.appendChild(footer);

    refs.chatEl.appendChild(msg);

    return msg;
  });
};

export const setAssistantRaw = ({ msgEl, includeReasoning, combinedMd }, reasoning = "", content = "") => {
  msgEl.setAttribute(
    "data-raw-md",
    combinedMd ?? buildCombinedForRender({ includeReasoning }, reasoning, content)
  );
  msgEl.setAttribute("data-raw-cot", reasoning ?? "");
  msgEl.setAttribute("data-raw-answer", content ?? "");
  updateFooterCopyEnabled(msgEl);
};

export const finalizeAssistantFooter = (msgEl) => {
  msgEl.classList.add("finalized");
  updateFooterCopyEnabled(msgEl);
};

export const closeReasoningDetails = (msgEl) => {
  qsa(bodyEl(msgEl), "details.think-block").forEach((d) => (d.open = false));
  qsa(bodyEl(msgEl), "details.tool-block").forEach((d) => (d.open = false));
};

const fmtDur = (ms = 0) => {
  const sec = Math.max(0, Math.round(Number(ms || 0) / 1000));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h ? `${h}h${m}m${s}s` : m ? `${m}m${s}s` : `${s}s`;
};

export const applyTimeMarkers = (msgEl, reasonMs, answerMs) => {
  const body = bodyEl(msgEl);

  if (Number.isFinite(reasonMs)) {
    const sum = qs(body, "details.think-block > summary");
    if (sum) {
      qs(sum, ".time-marker")?.remove();
      const span = document.createElement("span");
      span.className = "time-marker";
      span.textContent = `Reasoned (${fmtDur(reasonMs)})`;
      sum.appendChild(span);
    }
  }

  if (Number.isFinite(answerMs)) {
    const marker = qs(msgEl, ".assistant-footer .answer-marker");
    if (marker) marker.textContent = `Answered (${fmtDur(answerMs)})`;
  }
};

export const rebuildChatUiFromMessages = ({ state, refs }) => {
  clearChatUi({ refs });

  for (const m of state.messages) {
    if (!m || (m.role !== "user" && m.role !== "assistant")) continue;

    if (m.role === "user") {
      appendUserMessage({ refs }, userDisplayFromPayload(m.content || ""));
      continue;
    }

    const el = createAssistantMessageElement({ refs });
    el.classList.add("finalized");

    el.setAttribute("data-raw-md", m.content || "");
    el.setAttribute("data-raw-answer", m.content || "");
    el.setAttribute("data-raw-cot", "");

    renderMarkdownInto(bodyEl(el), m.content || "");
    closeReasoningDetails(el);
    updateFooterCopyEnabled(el);
  }

  refs.chatEl.scrollTop = refs.chatEl.scrollHeight;
};
