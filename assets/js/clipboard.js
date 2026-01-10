// assets/js/clipboard.js
//
// Clipboard + UI button helpers (copy + flash), extracted from the original single-file implementation.

export const copyText = async (text) => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = String(text ?? "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      return true;
    } catch {
      return false;
    }
  }
};

export const flash = (btn, ok, { okText = "Copied", failText = "Failed", ms = 900 } = {}) => {
  if (!btn) return;
  const prev = btn.textContent;
  btn.textContent = ok ? okText : failText;
  btn.disabled = true;
  setTimeout(() => {
    btn.textContent = prev;
    btn.disabled = false;
  }, ms);
};

export const mkBtn = ({ text, title, cls, onClick }) => {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = String(text ?? "");
  if (title) b.title = String(title);
  if (cls) b.className = String(cls);
  if (typeof onClick === "function") b.addEventListener("click", onClick);
  return b;
};
