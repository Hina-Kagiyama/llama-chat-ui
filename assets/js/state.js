// assets/js/state.js
//
// Centralized application state shared across modules.
// Keep this intentionally small and serializable where practical.
//
// Design notes:
// - UI modules should read/write state here rather than creating ad-hoc globals.
// - Timers/caches that are purely internal to a module can remain module-private;
//   only put cross-module shared state here.

export const state = {
  /* ---------- send / conversation ---------- */
  isSending: false,

  // Rolling window of messages sent to the backend (OpenAI-compatible format).
  // Each item: { role: "user"|"assistant", content: string }
  messages: [],

  // Keep last N messages to avoid unbounded context growth.
  maxMessages: 20,

  /* ---------- attachments ---------- */
  // Pending attachments to be appended to the NEXT user message.
  // Each item shape mirrors the original code:
  // {
  //   id, name, mime, size,
  //   mode: "text"|"meta",
  //   truncated?: boolean, sliceBytes?: number,
  //   payload: string,
  //   summary: string
  // }
  pendingAttachments: [],
  nextAttachmentId: 1,

  // Text files are truncated to this many bytes when appended to prompt.
  maxTextFileBytesToSend: 300 * 1024,

  /* ---------- models / context ---------- */
  lastModels: [],
  modelsFetchInFlight: null,

  // Context size (if the server returns it via /v1/models metadata).
  ctxSize: null,

  /* ---------- usage / headline stats ---------- */
  // Last usage object received from stream_options.include_usage
  // Shape typically: { prompt_tokens, completion_tokens, total_tokens }
  lastUsage: null,

  // Live stream stats used for speed and timing markers.
  // send.js should reinitialize per request.
  // {
  //   startTs,
  //   completionChars,
  //   reasonStartTs, reasonEndTs,
  //   answerStartTs, answerEndTs
  // }
  liveStats: null,

  // Headline refresh (speed/tokens) ticker state; headline.js manages these.
  headlineTimerId: null,
  lastHeadlinePaintTs: 0,

  /* ---------- render throttling ---------- */
  // markdown.js may use these for streaming render coalescing.
  renderTimeoutId: null,
  pendingRender: { el: null, text: "" },
};
