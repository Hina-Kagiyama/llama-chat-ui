// assets/js/main.js
//
// App entry point (orchestrator).
// Assumes all other modules exist in the project structure as previously proposed.
//
// Notes:
// - marked + DOMPurify are loaded as globals by index.html (CDN or local vendor).
// - MathJax is configured + loaded by index.html.

import { $, on } from "./dom.js";
import { state } from "./state.js";

import { updateLayout, installResizeObservers } from "./layout.js";
import { resetHeadline } from "./headline.js";

import { setModelInputEnabled, fetchModels } from "./models.js";

import {
  renderAttachmentsUi,
  attachFileToPending,
  clearPendingAttachments,
} from "./attachments.js";

import {
  exportConversationJson,
  importConversationJsonText,
  downloadText,
} from "./persistence.js";

import { rebuildChatUiFromMessages } from "./chat_ui.js";
import { sendMessage } from "./send.js";

/* ---------- DOM refs ---------- */
const refs = {
  headerEl: $("header"),
  footerEl: $("footer"),
  chatEl: $("chat"),

  // Header controls
  endpointEl: $("endpoint"),
  autoModelEl: $("autoModel"),
  modelEl: $("model"),
  refreshModelsBtnEl: $("refreshModelsBtn"),
  includeReasoningEl: $("includeReasoning"),
  saveBtnEl: $("saveBtn"),
  loadBtnEl: $("loadBtn"),
  loadInputEl: $("loadInput"),

  // Headline output
  statusEl: $("status"),
  tokensEl: $("tokens"),
  speedEl: $("speed"),

  // Footer controls
  attachFileBtn: $("attachFileBtn"),
  fileInputEl: $("fileInput"),
  fileStatusEl: $("fileStatus"),
  attachmentsEl: $("attachments"),
  promptEl: $("prompt"),
  sendBtn: $("sendBtn"),
};

const setUiSending = (sending) => {
  // state.isSending = !!sending;
  const disabled = !!sending;
  [
    refs.sendBtn,
    refs.attachFileBtn,
    refs.saveBtnEl,
    refs.loadBtnEl,
    refs.refreshModelsBtnEl,
  ].forEach((b) => b && (b.disabled = disabled));
};

const relayout = () => updateLayout(refs.headerEl, refs.footerEl, refs.chatEl);

let endpointDebounceId = null;

const handleSend = async () => {
  if (state.isSending) return;

  // send.js owns: payload build, streaming loop, message UI updates, token/speed updates, etc.
  // It should consult refs.includeReasoningEl.checked, refs.modelEl.value, etc.
  setUiSending(true);
  try {
    await sendMessage({ state, refs, relayout });
  } finally {
    setUiSending(false);
    relayout();
  }
};

const handleAttachClick = () => {
  if (state.isSending) return;
  if (refs.fileInputEl) {
    refs.fileInputEl.value = "";
    refs.fileInputEl.click();
  }
};

const handleFileInputChange = async () => {
  const input = refs.fileInputEl;
  if (!input) return;

  const files = input.files ? [...input.files] : [];
  if (!files.length) return;

  try {
    refs.attachFileBtn.disabled = true;
    for (const f of files) {
      await attachFileToPending({ file: f, state, refs, relayout });
    }
  } catch (e) {
    // attachments.js / chat_ui.js typically handles user-visible error reporting.
    // If you prefer centralizing UI errors, do it here.
    console.error(e);
  } finally {
    refs.attachFileBtn.disabled = !!state.isSending;
    input.value = "";
    relayout();
  }
};

const handleAutoModelChange = async () => {
  setModelInputEnabled({ state, refs });

  if (refs.autoModelEl?.checked) {
    await fetchModels({ state, refs });
  }
};

const handleEndpointInput = () => {
  if (endpointDebounceId) clearTimeout(endpointDebounceId);
  endpointDebounceId = setTimeout(async () => {
    endpointDebounceId = null;
    if (refs.autoModelEl?.checked) await fetchModels({ state, refs });
  }, 400);
};

const handleSave = () => {
  try {
    const jsonText = exportConversationJson(state.messages);
    downloadText("conversation.json", jsonText);
  } catch (e) {
    console.error(e);
    // If you prefer user-visible error, route through chat_ui.js (appendUserMessage) here.
  }
};

const handleLoadClick = () => {
  if (state.isSending) return;
  if (refs.loadInputEl) {
    refs.loadInputEl.value = "";
    refs.loadInputEl.click();
  }
};

const handleLoadInputChange = async () => {
  const f = refs.loadInputEl?.files?.[0];
  if (!f) return;

  try {
    const text = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onerror = () => reject(new Error("Failed to read file."));
      r.onload = () => resolve(String(r.result || ""));
      r.readAsText(f);
    });

    const { messages } = importConversationJsonText(text);

    // Adopt imported state
    state.messages = messages;
    state.isSending = false;

    // Reset UI state
    refs.promptEl.value = "";
    clearPendingAttachments({ state, refs, relayout });

    // Rebuild chat window from imported messages
    rebuildChatUiFromMessages({ state, refs });

    resetHeadline({ state, refs });
    // status text is typically managed by headline.js; if needed, set it there.
    relayout();
  } catch (e) {
    console.error(e);
    // If you prefer user-visible error, route through chat_ui.js (appendUserMessage) here.
  } finally {
    if (refs.loadInputEl) refs.loadInputEl.value = "";
    relayout();
  }
};

/* ---------- wire events ---------- */
const wireEvents = () => {
  on(refs.sendBtn, "click", handleSend);
  on(refs.promptEl, "keydown", (e) => {
    const isEnter = e.key === "Enter";
    const sendChord = e.ctrlKey || e.metaKey;
    if (isEnter && sendChord) {
      e.preventDefault();
      handleSend();
    }
  });

  on(refs.attachFileBtn, "click", handleAttachClick);
  on(refs.fileInputEl, "change", handleFileInputChange);

  on(refs.autoModelEl, "change", handleAutoModelChange);
  on(refs.refreshModelsBtnEl, "click", () => fetchModels({ state, refs }));
  on(refs.endpointEl, "input", handleEndpointInput);

  on(refs.saveBtnEl, "click", handleSave);
  on(refs.loadBtnEl, "click", handleLoadClick);
  on(refs.loadInputEl, "change", handleLoadInputChange);

  on(window, "resize", relayout);
};

/* ---------- init ---------- */
const init = async () => {
  // Initial UI focus and layout
  refs.promptEl?.focus();

  // Allow models.js to control model field state
  setModelInputEnabled({ state, refs });

  // Headline should start in a clean state
  resetHeadline({ state, refs });

  // Keep layout synced to fixed header/footer changes
  installResizeObservers({ headerEl: refs.headerEl, footerEl: refs.footerEl, onResize: relayout });

  // Render attachments UI with empty state
  renderAttachmentsUi({ state, refs, relayout });

  // First layout pass
  relayout();

  // Auto-fetch models if enabled
  if (refs.autoModelEl?.checked) {
    await fetchModels({ state, refs });
  }
};

wireEvents();
window.addEventListener("load", () => {
  // Avoid top-level await so the module loads cleanly everywhere.
  init().catch((e) => console.error("Init failed:", e));
});
