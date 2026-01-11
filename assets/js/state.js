export const state = {
  isSending: false,

  // Each item: { role: "user"|"assistant", content: string }
  messages: [],
  maxMessages: 20,

  // {
  //   id, name, mime, size,
  //   mode: "text"|"meta",
  //   truncated?: boolean, sliceBytes?: number,
  //   payload: string,
  //   summary: string
  // }
  pendingAttachments: [],
  nextAttachmentId: 1,

  maxTextFileBytesToSend: 300 * 1024,

  lastModels: [],
  modelsFetchInFlight: null,

  ctxSize: null,

  // { prompt_tokens, completion_tokens, total_tokens }
  lastUsage: null,

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

  // markdown.js may use these for streaming render coalescing.
  renderTimeoutId: null,
  pendingRender: { el: null, text: "" },
};
