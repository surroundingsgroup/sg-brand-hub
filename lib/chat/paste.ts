// Pasting formatted text (from a doc, an email, a Claude reply) into the chat
// box: the browser's plain-text copy drops list numbers and bullets and can
// run lines together. Rebuild plain text from the pasted HTML instead, keeping
// numbered lists, bullets and line breaks. Browser only (uses DOMParser).

const BLOCK = new Set([
  "P", "DIV", "SECTION", "ARTICLE", "HEADER", "FOOTER", "BLOCKQUOTE", "PRE",
  "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "LI", "TABLE", "TR",
]);

/** Plain text that keeps the structure of pasted HTML, or null when there is nothing to fix. */
export function htmlToChatText(html: string): string | null {
  if (!/<(li|p|br|div|h[1-6])\b/i.test(html)) return null;
  const doc = new DOMParser().parseFromString(html, "text/html");
  let out = "";
  const nl = (n: number) => {
    // Never break right after a list marker ("1. ", "• ").
    if (/(^|\n)(\d+\.|•) $/.test(out)) return;
    const trail = out.match(/\n*$/)?.[0].length ?? 0;
    if (out.length && trail < n) out += "\n".repeat(n - trail);
  };

  function walk(node: Node, pre: boolean, inLi = false) {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = pre ? node.textContent ?? "" : (node.textContent ?? "").replace(/\s+/g, " ");
      // No leading space at the start of a line.
      out += /(^|\n)$/.test(out) ? t.replace(/^ /, "") : t;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    const tag = el.tagName;
    if (tag === "STYLE" || tag === "SCRIPT" || tag === "META") return;
    if (tag === "BR") {
      out += "\n";
      return;
    }
    if (tag === "LI") {
      nl(1);
      const parent = el.parentElement;
      if (parent?.tagName === "OL") {
        const start = Number(parent.getAttribute("start")) || 1;
        const idx = Array.from(parent.children).filter((c) => c.tagName === "LI").indexOf(el);
        out += `${start + idx}. `;
      } else {
        out += "• ";
      }
      el.childNodes.forEach((c) => walk(c, pre, true));
      nl(1);
      return;
    }
    const block = BLOCK.has(tag);
    // Paragraphs and lists get a blank line around them, except inside a list
    // item (keeps "1. ..." / "2. ..." on consecutive lines).
    const gap = !inLi && (tag === "P" || /^H[1-6]$/.test(tag) || tag === "UL" || tag === "OL") ? 2 : 1;
    if (block) nl(gap);
    el.childNodes.forEach((c) => walk(c, pre || tag === "PRE", inLi && tag !== "UL" && tag !== "OL"));
    if (block) nl(gap);
  }

  walk(doc.body, false);
  const text = out
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text || null;
}
