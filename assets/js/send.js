import { now } from "./dom.js";
import { buildUserPayload, buildUserDisplay, clearPendingAttachments } from "./attachments.js";
import {
  appendUserMessage,
  createAssistantMessageElement,
  setAssistantRaw,
  finalizeAssistantFooter,
  applyTimeMarkers,
  // buildCombinedForRender,
  closeDetailsById,
  closeReasoningDetails
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

const safeJsonParse = (s) => {
  try { return JSON.parse(String(s ?? "")); } catch { return null; }
};

// Accumulate streaming tool_calls deltas into final array
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

const finalizeToolCalls = (buffersByIndex) =>
  [...buffersByIndex.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v).filter((v) => v?.id && v?.function?.name);

// events[] already includes finalized <think state="done"> and <tool state="done"> blocks in correct order.
// We add the live block (if any) and/or the current assistant text.
const buildDisplayMd = ({ includeReasoning, prefixMd, liveThinkId, liveThinkState, liveReasoning, assistantText }) => {
  const parts = [];
  if (prefixMd) parts.push(prefixMd);

  if (includeReasoning && String(liveReasoning ?? "").trim()) {
    // parts.push(`<think id="${liveThinkId}" state="live">${String(liveReasoning).trim()}</think>`);
    parts.push(
      `<think id="${liveThinkId}" state="${liveThinkState || "live"}">${String(liveReasoning).trim()}</think>`
    );
  }

  if (assistantText) parts.push(assistantText);

  return parts.join("\n\n");
};

const toolBlockMd = ({ id, name, argsStr, resultStr }) => {
  return `<tool id="${id}" name="${name}" state="done">\nINPUT:\n${argsStr}\n\nOUTPUT:\n${resultStr}\n</tool>`;
};

const executeToolCalls = async (toolCalls) => {
  const toolMessages = [];
  const toolEvents = [];

  for (let i = 0; i < toolCalls.length; i++) {
    const tc = toolCalls[i];
    const callId = tc.id;
    const name = tc?.function?.name || "tool";
    const argsStr = tc?.function?.arguments ?? "";
    const args = safeJsonParse(argsStr) ?? {};

    let resultObj;
    try {
      resultObj = await runTool(name, args);
    } catch (e) {
      resultObj = { error: String(e?.message || e) };
    }

    const resultStr = typeof resultObj === "string" ? resultObj : JSON.stringify(resultObj);

    toolMessages.push({
      role: "tool",
      tool_call_id: callId,
      content: resultStr,
    });

    toolEvents.push(
      toolBlockMd({
        id: `tool_${callId || i}`,
        name,
        argsStr: argsStr || "{}",
        resultStr,
      })
    );
  }

  return { toolMessages, toolEvents };
};

/**
 * One streaming round; renders:
 * - prefixMd (done events)
 * - live reasoning block for this round
 * - assistantText
 *
 * Returns assistantText, reasoningText, toolCalls, finalUsage
 */
const runStreamingRound = async ({
  state, refs,
  endpoint, model,
  messages,
  msgEl,
  toolSchemas,
  includeReasoning,
  prefixMd,
  liveThinkId,
  cotPrefix,
}) => {
  let assistantText = "";
  let reasoningText = "";
  let finalUsage = null;

  const toolBuffers = new Map();
  let liveThinkState = "live"; // becomes "done" once answer starts
  let reasoningAutoClosed = false;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      stream_options: { include_usage: true },
      tools: toolSchemas,
      tool_choice: toolSchemas?.length ? "auto" : undefined,
    }),
  });

  if (!response.ok) throw new Error(`HTTP ${response.status} – ${response.statusText}`);

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");

  let done = false;
  let buffer = "";

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

        if (Array.isArray(dToolCalls)) mergeToolCallsDelta(toolBuffers, dToolCalls);

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

          // collapse reasoning block once answer begins
          if (!reasoningAutoClosed) {
            liveThinkState = "done";   // important
            reasoningAutoClosed = true;
          }
        }

        if (dReason || dContent) {
          if (state.liveStats) state.liveStats.completionChars += (dReason.length + dContent.length);

          const combinedMd = buildDisplayMd({
            includeReasoning,
            prefixMd,
            liveThinkId,
            liveThinkState,
            liveReasoning: reasoningText,
            assistantText,
          });

          const cotCombined = [cotPrefix, String(reasoningText ?? "").trim()].filter(Boolean).join("\n\n");

          setAssistantRaw(
            { msgEl, includeReasoning, combinedMd },
            cotCombined,
            assistantText
          );

          scheduleStreamingRender({
            state,
            msgEl,
            text: combinedMd,
            scrollEl: refs.chatEl,
            thresholdPx: 180,
          });

          paintHeadline({ state, refs }, false);
        }
      } catch (e) {
        console.warn("Failed to parse SSE line:", dataStr, e);
      }
    }
  }

  if (!assistantText && !reasoningText && buffer.trim()) {
    try {
      const json = JSON.parse(buffer.trim());
      const msg = json?.choices?.[0]?.message ?? {};
      assistantText = msg.content ?? "";
      reasoningText = msg.reasoning_content ?? (msg.reasoning ?? "");

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

  return { assistantText, reasoningText, toolCalls: finalizeToolCalls(toolBuffers), finalUsage };
};

export const sendMessage = async ({ state, refs, relayout }) => {
  const promptText = String(refs?.promptEl?.value ?? "").trim();
  const hasAtts = Array.isArray(state.pendingAttachments) && state.pendingAttachments.length > 0;

  if ((!promptText && !hasAtts) || state.isSending) return;
  state.isSending = true;

  const toolSchemas = getToolSchemas();
  const includeReasoning = !!refs?.includeReasoningEl?.checked;

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

    let workingMessages = [...(state.messages || []), { role: "user", content: userPayload }];

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

    const msgEl = createAssistantMessageElement({ refs });

    const events = [];
    const allReasoningParts = [];

    const MAX_TOOL_ROUNDS = 4;

    let assistantText = "";
    let finalUsage = null;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const prefixMd = events.join("\n\n");
      const liveThinkId = `think_r${round + 1}`;

      const cotPrefix = allReasoningParts.join("\n\n");

      const r = await runStreamingRound({
        state, refs,
        endpoint, model,
        messages: workingMessages,
        msgEl,
        toolSchemas,
        includeReasoning,
        prefixMd,
        liveThinkId,
        cotPrefix,
      });

      assistantText = r.assistantText;
      finalUsage = r.finalUsage;

      const roundReasoning = String(r.reasoningText ?? "").trim();
      if (roundReasoning) {
        allReasoningParts.push(roundReasoning);

        if (includeReasoning) {
          events.push(`<think id="${liveThinkId}" state="done">${roundReasoning}</think>`);
        }
      }

      if (!r.toolCalls.length) break;

      setStatus({ refs }, `Calling ${r.toolCalls.length} tool(s)…`);

      const { toolMessages, toolEvents } = await executeToolCalls(r.toolCalls);

      workingMessages = [
        ...workingMessages,
        { role: "assistant", content: "", tool_calls: r.toolCalls },
        ...toolMessages,
      ];

      events.push(...toolEvents);

      const combinedMd = [events.join("\n\n"), assistantText].filter(Boolean).join("\n\n");
      setAssistantRaw(
        { msgEl, includeReasoning, combinedMd },
        allReasoningParts.join("\n\n"),
        assistantText
      );
      renderMarkdownInto(bodyEl(msgEl), combinedMd);

      setStatus({ refs }, "Streaming…");
    }

    if (state.renderTimeoutId) {
      clearTimeout(state.renderTimeoutId);
      state.renderTimeoutId = null;
    }
    stopHeadline({ state });

    const finalMd = [events.join("\n\n"), assistantText].filter(Boolean).join("\n\n");

    setAssistantRaw(
      { msgEl, includeReasoning, combinedMd: finalMd },
      allReasoningParts.join("\n\n"),
      assistantText
    );
    renderMarkdownInto(bodyEl(msgEl), finalMd);

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

    state.messages = [...workingMessages, { role: "assistant", content: assistantText }];
    trimConversation(state);

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
