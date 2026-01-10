// assets/js/persistence.js
//
// Save/load conversation JSON + download helper + user-friendly display parsing.
// Ported from the original single-file implementation.

import { humanKB } from "./dom.js";

/* ---------- export / download ---------- */
export const exportConversationJson = (messages = []) => {
  const safe = Array.isArray(messages)
    ? messages
      .filter((m) => m && (m.role === "user" || m.role === "assistant"))
      .map((m) => ({ role: m.role, content: String(m.content ?? "") }))
    : [];

  return JSON.stringify({ v: 1, messages: safe });
};

export const downloadText = (filename, text) => {
  const blob = new Blob([String(text ?? "")], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(() => URL.revokeObjectURL(url), 2000);
};

/* ---------- import ---------- */
export const importConversationJsonText = (text) => {
  let obj;
  try {
    obj = JSON.parse(String(text ?? ""));
  } catch {
    throw new Error("Invalid JSON.");
  }

  if (!obj || typeof obj !== "object" || !Array.isArray(obj.messages)) {
    throw new Error("Invalid conversation format.");
  }

  const messages = obj.messages
    .filter((x) => x && (x.role === "user" || x.role === "assistant") && typeof x.content === "string")
    .map((x) => ({ role: x.role, content: x.content }));

  return { messages };
};

/* ---------- user display parsing ---------- */
/**
 * Converts the stored "user payload" (which may include the appended attachment blocks)
 * into a user-friendly display:
 * - shows the original prompt (pre-attachments)
 * - shows a bullet list of attachment metadata derived from the payload
 *
 * This mirrors the original behavior so loading/saving doesn't dump full inline file text into the UI.
 */
export const userDisplayFromPayload = (payload) => {
  const s = String(payload ?? "");
  const marker = "\n\n=== ATTACHMENTS (appended) ===\n";
  const idx = s.indexOf(marker);
  if (idx === -1) return s;

  const promptPart = s.slice(0, idx).trim();
  const attachPart = s.slice(idx + marker.length);
  const lines = attachPart.split("\n");

  const files = [];
  let cur = null;

  for (const line of lines) {
    const mFile = line.match(/^FILE:\s*(.+)$/);
    const mName = line.match(/^NAME:\s*(.+)$/);
    const mMime = line.match(/^MIME:\s*(.+)$/);
    const mSize = line.match(/^SIZE:\s*(\d+)\s*bytes/);

    if (mFile) {
      cur = { name: mFile[1].trim() };
      files.push(cur);
    }
    if (mName) {
      cur = { name: mName[1].trim() };
      files.push(cur);
    }
    if (cur && mMime) cur.mime = mMime[1].trim();
    if (cur && mSize) cur.size = Number(mSize[1]);
  }

  const out = [];
  if (promptPart) out.push(promptPart);

  out.push("", "**Attachments:**");

  // De-dupe
  const seen = new Set();
  const uniq = files.filter((f) => {
    const k = `${f.name}|${f.mime || ""}|${f.size || ""}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  if (uniq.length) {
    uniq.slice(0, 25).forEach((f) => {
      const mime = f.mime || "unknown";
      const size = Number.isFinite(f.size) ? humanKB(f.size) : "";
      out.push(`- \`${f.name}\` (${mime}${size ? `, ${size}` : ""})`);
    });
  } else {
    out.push("- (attachments present in payload)");
  }

  return out.join("\n");
};
