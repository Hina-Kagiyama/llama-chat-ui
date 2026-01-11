import { humanKB } from "./dom.js";

const isLikelyTextFile = (file) => {
  if (!file) return false;
  if (file.type?.startsWith("text/")) return true;

  const n = String(file.name ?? "").toLowerCase();
  return [
    ".txt",
    ".md",
    ".markdown",
    ".json",
    ".csv",
    ".tsv",
    ".js",
    ".ts",
    ".py",
    ".html",
    ".css",
    ".xml",
    ".yaml",
    ".yml",
    ".ini",
    ".toml",
    ".log",
  ].some((ext) => n.endsWith(ext));
};

const readTextFileForChat = async (file, maxBytes) => {
  const sliced = file.size > maxBytes ? file.slice(0, maxBytes) : file;
  const truncated = file.size > maxBytes;

  const text = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error("Failed to read file as text."));
    r.onload = () => resolve(String(r.result ?? ""));
    r.readAsText(sliced);
  });

  return { text, truncated, sliceBytes: sliced.size };
};

export const renderAttachmentsUi = ({ state, refs, relayout }) => {
  const { attachmentsEl, fileStatusEl } = refs;

  if (!attachmentsEl || !fileStatusEl) return;

  attachmentsEl.innerHTML = "";

  const atts = state.pendingAttachments;

  if (!atts.length) {
    fileStatusEl.textContent = "No attachments";
    fileStatusEl.title = "";
    relayout?.();
    return;
  }

  fileStatusEl.textContent = `${atts.length} attachment${atts.length === 1 ? "" : "s"} ready`;
  fileStatusEl.title = atts.map((a) => a.name).join(", ");

  for (const att of atts) {
    const chip = document.createElement("div");
    chip.className = "att-chip";

    const nameSpan = document.createElement("span");
    nameSpan.className = "att-name";
    nameSpan.textContent = att.summary;
    nameSpan.title = att.summary;

    const rm = document.createElement("button");
    rm.type = "button";
    rm.textContent = "Remove";
    rm.addEventListener("click", () => {
      state.pendingAttachments = state.pendingAttachments.filter((x) => x.id !== att.id);
      renderAttachmentsUi({ state, refs, relayout });
    });

    chip.appendChild(nameSpan);
    chip.appendChild(rm);
    attachmentsEl.appendChild(chip);
  }

  relayout?.();
};

export const attachFileToPending = async ({ file, state, refs, relayout }) => {
  const name = file?.name || "(unnamed)";
  const mime = file?.type || "application/octet-stream";
  const size = file?.size || 0;
  const id = state.nextAttachmentId++;

  if (refs?.fileStatusEl) {
    refs.fileStatusEl.textContent = `Attaching: ${name} (${humanKB(size)})…`;
    refs.fileStatusEl.title = name;
  }

  const isText = isLikelyTextFile(file);

  if (!isText) {
    const payload =
      `FILE (metadata only — binary not transmitted)\n` +
      `NAME: ${name}\nMIME: ${mime}\nSIZE: ${size} bytes\n\n` +
      `The client did not transmit the binary content. If analysis is needed, provide a text export or paste relevant text.`;

    state.pendingAttachments.push({
      id,
      name,
      mime,
      size,
      mode: "meta",
      payload,
      summary: `${name} (${mime}, ${humanKB(size)}) — metadata only`,
    });

    renderAttachmentsUi({ state, refs, relayout });
    return;
  }

  const maxBytes = Number(state.maxTextFileBytesToSend) || 300 * 1024;
  const { text, truncated, sliceBytes } = await readTextFileForChat(file, maxBytes);
  const truncNote = truncated ? `NOTE: File was truncated to the first ${humanKB(sliceBytes)} for sending.\n` : "";

  const payload =
    `FILE: ${name}\nMIME: ${mime}\nSIZE: ${size} bytes\n` +
    `${truncNote}\n` +
    `<<<BEGIN FILE (TEXT) ${name}>>>\n${text}\n<<<END FILE>>>\n`;

  state.pendingAttachments.push({
    id,
    name,
    mime,
    size,
    mode: "text",
    truncated,
    sliceBytes,
    payload,
    summary: `${name} (${mime}, ${humanKB(size)})${truncated ? ` — truncated to ${humanKB(sliceBytes)}` : ""}`,
  });

  renderAttachmentsUi({ state, refs, relayout });
};

export const buildUserPayload = (promptText = "", atts = []) => {
  const p = String(promptText ?? "").trim();
  if (!atts.length) return p;

  return [
    ...(p ? [p] : []),
    "\n\n=== ATTACHMENTS (appended) ===\n",
    ...atts.flatMap((a) => [String(a.payload ?? "").trimEnd(), "\n"]),
    "=== END ATTACHMENTS ===",
  ].join("");
};

export const buildUserDisplay = (promptText = "", atts = []) => {
  const p = String(promptText ?? "").trim();
  const lines = [];
  if (p) lines.push(p);

  if (atts.length) {
    lines.push("", "**Attachments:**");
    for (const a of atts) {
      const kind = a.mode === "text" ? "text sent" : "metadata only";
      lines.push(
        `- \`${a.name}\` (${a.mime || "unknown"}, ${humanKB(a.size)}) — ${kind}${a.truncated ? `, truncated to ${humanKB(a.sliceBytes)}` : ""
        }`
      );
    }
  }

  return lines.join("\n");
};

export const clearPendingAttachments = ({ state, refs, relayout }) => {
  state.pendingAttachments = [];
  renderAttachmentsUi({ state, refs, relayout });
};
