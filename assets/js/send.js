import { now } from "./dom.js";

import { buildUserPayload, buildUserDisplay, clearPendingAttachments } from "./attachments.js";

import {
  appendUserMessage,
  createAssistantMessageElement,
  setAssistantRaw,
  finalizeAssistantFooter,
  applyTimeMarkers,
  closeReasoningDetails,
  buildCombinedForRender,
} from "./chat_ui.js";

import { renderMarkdownInto, scheduleStreamingRender } from "./markdown.js";

import {
  setStatus,
  setTokens,
  setSpeed,
  resetHeadline,
  startHeadline,
  stopHeadline,
  paintHeadline,
} from "./headline.js";

import { fetchModels } from "./models.js";

import { getToolSchemas, runTool } from "./tools.js";

/* ---------- internal helpers ---------- */
const bodyEl = (msgEl) => msgEl?.querySelector?.(".msg-body") ?? msgEl;

const ensureModelSelected = async ({ state, refs }) => {
  const auto = !!refs?.autoModelEl?.checked;
  const model = String(refs?.modelEl?.value ?? "").trim();
  if (auto && !model) await fetchModels({ state, refs });
};

const trimConversation = (state) => {
  const max = Number(state.maxMessages) || 20;
  if (Array.isArray(state.messages) && state.messages.length > max) {
    state.messages = state.messages.slice(-max);
  }
};

const parseMaybeUsage = (parsed) => {
  const u = parsed?.usage;
  return u && typeof u.total_tokens === "number" ? u : null;
};

// Accumulate streaming tool_calls deltas into a final array (OpenAI-style).
const mergeToolCallsDelta = (buffersByIndex, toolCallsDelta = []) => {
  for (const tc of toolCallsDelta) {
    const idx = Number(tc?.index ?? 0);
    const cur = buffersByIndex.get(idx) ?? { id: null, type: "function", function: { name: "", arguments: "" } };

    if (tc?.id) cur.id = tc.id;
    if (tc?.type) cur.type = tc.type;

    const fn = tc?.function ?? {};
    if (fn.name) cur.function.name = fn.name;
    if (typeof fn.arguments === "string") cur.function.arguments += fn.arguments;

    buffersByIndex.set(idx, cur);
  }
};

const finalizeToolCalls = (buffersByIndex) => {
  return [...buffersByIndex.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, v]) => v)
    .filter((v) => v?.id && v?.function?.name);
};

const safeJsonParse = (s) => {
  try { return JSON.parse(String(s ?? "")); } catch { return null; }
};

const executeToolCalls = async (toolCalls) => {
  const toolMessages = [];
  for (const tc of toolCalls) {
    const id = tc.id;
    const name = tc?.function?.name;
    const argsStr = tc?.function?.arguments ?? "";
    const args = safeJsonParse(argsStr) ?? {};

    let result;
    try {
      result = await runTool(name, args);
    } catch (e) {
      result = { error: String(e?.message || e) };
    }

    toolMessages.push({
      role: "tool",
      tool_call_id: id,
      content: typeof result === "string" ? result : JSON.stringify(result),
    });
  }
  return toolMessages;
};

/**
 * One streaming round. Returns:
 * - assistantText, reasoningText
 * - toolCalls (array)
 * - finalUsage
 */
const runStreamingRound = async ({ state, refs, endpoint, model, messages, msgEl, toolSchemas }) => {
  let assistantText = "";
  let reasoningText = "";
  let finalUsage = null;

  const toolBuffers = new Map(); // index -> {id, function:{name, arguments}}

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      stream_options: { include_usage: true },

      // tools
      tools: toolSchemas,
      tool_choice: toolSchemas?.length ? "auto" : undefined,
    }),
  });

  if (!response.ok) throw new Error(`HTTP ${response.status} – ${response.statusText}`);

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");

  let done = false;
  let buffer = "";
  let reasoningAutoClosed = false;

  while (!done) {
    const { value, done: readerDone } = await reader.read();
    done = readerDone;
    if (!value) continue;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;

      const dataStr = trimmed.slice(5).trim();
      if (dataStr === "[DONE]") { done = true; break; }

      try {
        const parsed = JSON.parse(dataStr);

        const maybeUsage = parseMaybeUsage(parsed);
        if (maybeUsage) {
          finalUsage = maybeUsage;
          setTokens({ state, refs }, finalUsage);
        }

        const delta = parsed?.choices?.[0]?.delta ?? {};
        const dContent = delta.content ?? "";
        const dReason = delta.reasoning_content ?? (delta.reasoning ?? "");
        const dToolCalls = delta.tool_calls ?? null;

        const ts = now();

        if (dToolCalls && Array.isArray(dToolCalls)) {
          mergeToolCallsDelta(toolBuffers, dToolCalls);
        }

        if (dReason) {
          reasoningText += dReason;
          if (state.liveStats) {
            state.liveStats.reasonStartTs ??= ts;
            state.liveStats.reasonEndTs = ts;
          }
        }

        if (dContent) {
          assistantText += dContent;
          if (state.liveStats) {
            state.liveStats.answerStartTs ??= ts;
            state.liveStats.answerEndTs = ts;
          }

          if (!reasoningAutoClosed && reasoningText) {
            closeReasoningDetails(msgEl);
            reasoningAutoClosed = true;
          }
        }

        if (dReason || dContent) {
          if (state.liveStats) state.liveStats.completionChars += (dReason.length + dContent.length);

          setAssistantRaw(
            { msgEl, includeReasoning: !!refs?.includeReasoningEl?.checked },
            reasoningText,
            assistantText
          );

          const combined = buildCombinedForRender(
            { includeReasoning: !!refs?.includeReasoningEl?.checked },
            reasoningText,
            assistantText
          );

          scheduleStreamingRender({
            state,
            msgEl,
            text: combined,
            scrollEl: refs.chatEl,       // if you applied the sticky-scroll refactor
            thresholdPx: 180,
          });

          paintHeadline({ state, refs }, false);
        }
      } catch (e) {
        console.warn("Failed to parse SSE line:", dataStr, e);
      }
    }
  }

  // Fallback non-stream JSON in trailing buffer (rare)
  if (!assistantText && !reasoningText && buffer.trim()) {
    try {
      const json = JSON.parse(buffer.trim());
      const msg = json?.choices?.[0]?.message ?? {};
      assistantText = msg.content ?? "";
      reasoningText = msg.reasoning_content ?? (msg.reasoning ?? "");

      // Non-stream tool_calls
      if (Array.isArray(msg.tool_calls)) {
        for (let i = 0; i < msg.tool_calls.length; i++) toolBuffers.set(i, msg.tool_calls[i]);
      }

      const maybeUsage = parseMaybeUsage(json);
      if (maybeUsage) {
        finalUsage = maybeUsage;
        setTokens({ state, refs }, finalUsage);
      }
    } catch {
      assistantText = "**Error:** Could not parse model response.";
    }
  }

  const toolCalls = finalizeToolCalls(toolBuffers);
  return { assistantText, reasoningText, toolCalls, finalUsage };
};

/* ---------- public API ---------- */
export const sendMessage = async ({ state, refs, relayout }) => {
  const promptText = String(refs?.promptEl?.value ?? "").trim();
  const hasAtts = Array.isArray(state.pendingAttachments) && state.pendingAttachments.length > 0;

  if ((!promptText && !hasAtts) || state.isSending) return;
  state.isSending = true;

  const toolSchemas = getToolSchemas();

  try {
    state.lastUsage = null;
    state.liveStats = null;
    resetHeadline({ state, refs });

    await ensureModelSelected({ state, refs });

    const endpoint =
      String(refs?.endpointEl?.value ?? "").trim() || "http://localhost:8080/v1/chat/completions";
    const model = String(refs?.modelEl?.value ?? "").trim() || "llama";

    const atts = state.pendingAttachments.slice();
    const userPayload = buildUserPayload(promptText, atts);
    const userDisplay = buildUserDisplay(promptText, atts);

    appendUserMessage({ refs }, userDisplay);

    // Start with: ...existing conversation + this user message
    let workingMessages = [...(state.messages || []), { role: "user", content: userPayload }];

    // Live stats init
    state.liveStats = {
      startTs: now(),
      completionChars: 0,
      reasonStartTs: null,
      reasonEndTs: null,
      answerStartTs: null,
      answerEndTs: null,
    };

    setTokens({ state, refs }, null);
    setSpeed({ refs }, 0, NaN);
    startHeadline({ state, refs });

    setStatus({ refs }, "Streaming…");

    // Single UI bubble for the *final* answer (tool calls stay behind the scenes)
    const msgEl = createAssistantMessageElement({ refs });

    const MAX_TOOL_ROUNDS = 4;

    let assistantText = "";
    let reasoningText = "";
    let finalUsage = null;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const r = await runStreamingRound({
        state,
        refs,
        endpoint,
        model,
        messages: workingMessages,
        msgEl,
        toolSchemas,
      });

      assistantText = r.assistantText;
      reasoningText = r.reasoningText;
      finalUsage = r.finalUsage;

      // If no tool calls, we are done.
      if (!r.toolCalls.length) break;

      setStatus({ refs }, `Calling ${r.toolCalls.length} tool(s)…`);

      // Append assistant tool_call message + tool results to the conversation
      // (We do not render this as a user-visible message; it is behind the scenes.)
      workingMessages = [
        ...workingMessages,
        { role: "assistant", content: "", tool_calls: r.toolCalls },
        ...(await executeToolCalls(r.toolCalls)),
      ];

      setStatus({ refs }, "Streaming…");
    }

    // Flush any pending render timer
    if (state.renderTimeoutId) {
      clearTimeout(state.renderTimeoutId);
      state.renderTimeoutId = null;
    }
    stopHeadline({ state });

    // Final render
    const combinedFinal = buildCombinedForRender(
      { includeReasoning: !!refs?.includeReasoningEl?.checked },
      reasoningText,
      assistantText
    );

    setAssistantRaw(
      { msgEl, includeReasoning: !!refs?.includeReasoningEl?.checked },
      reasoningText,
      assistantText
    );

    renderMarkdownInto(bodyEl(msgEl), combinedFinal);
    if (reasoningText) closeReasoningDetails(msgEl);

    // Timing markers
    const endTs = now();
    let reasonMs = null;
    let answerMs = null;

    if (state.liveStats) {
      if (state.liveStats.reasonStartTs != null) {
        reasonMs = Math.max(0, (state.liveStats.reasonEndTs ?? endTs) - state.liveStats.reasonStartTs);
      }
      if (assistantText && state.liveStats.answerStartTs == null) {
        state.liveStats.answerStartTs = state.liveStats.startTs;
        state.liveStats.answerEndTs = endTs;
      }
      if (state.liveStats.answerStartTs != null) {
        answerMs = Math.max(0, (state.liveStats.answerEndTs ?? endTs) - state.liveStats.answerStartTs);
      }
    }

    applyTimeMarkers(msgEl, reasonMs, answerMs);
    finalizeAssistantFooter(msgEl);

    // Persist conversation to state.messages:
    // - Keep the actual tool exchange in the context (workingMessages)
    // - But store only the final assistantText for UI/history, like before.
    state.messages = [...workingMessages, { role: "assistant", content: assistantText }];
    trimConversation(state);

    // Final speed paint
    if (finalUsage && state.liveStats) {
      const elapsed = Math.max((now() - state.liveStats.startTs) / 1000, 0.001);
      const chps = state.liveStats.completionChars / elapsed;
      const tkps =
        typeof finalUsage.completion_tokens === "number"
          ? finalUsage.completion_tokens / elapsed
          : NaN;
      setSpeed({ refs }, chps, tkps);
    } else {
      paintHeadline({ state, refs }, true);
    }

    if (refs?.promptEl) refs.promptEl.value = "";
    clearPendingAttachments({ state, refs, relayout });
    setStatus({ refs }, "Idle");
    relayout?.();
  } catch (err) {
    stopHeadline({ state });
    if (state.renderTimeoutId) {
      clearTimeout(state.renderTimeoutId);
      state.renderTimeoutId = null;
    }

    const errEl = createAssistantMessageElement({ refs });
    const rawErr = `**Error:** ${err?.message || "Unknown error."}`;

    errEl.setAttribute("data-raw-md", rawErr);
    errEl.setAttribute("data-raw-answer", rawErr);
    errEl.setAttribute("data-raw-cot", "");

    renderMarkdownInto(bodyEl(errEl), rawErr);
    finalizeAssistantFooter(errEl);

    setStatus({ refs }, "Idle");
    paintHeadline({ state, refs }, true);
    relayout?.();

    throw err;
  } finally {
    state.isSending = false;
  }
};
