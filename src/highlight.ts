/** Map a normalized evidence excerpt back to actual DOM text positions. */
export function highlightEvidence(root: HTMLElement, excerpt: string) {
  const registry = (CSS as unknown as { highlights?: Map<string, unknown> })
    .highlights;
  const HighlightConstructor = (
    window as unknown as { Highlight?: new (...ranges: Range[]) => unknown }
  ).Highlight;
  registry?.delete("evidence");
  if (!excerpt) return;
  const positions: { node: Text; offset: number }[] = [];
  let content = "";
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent || "";
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (/[\p{L}\p{N}]/u.test(ch)) {
        content += ch.toLowerCase();
        positions.push({ node: node as Text, offset: i });
      }
    }
  }
  const needle = excerpt.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  if (!needle) return;
  let start = -1;
  let length = 0;
  for (const size of [needle.length, 150, 70, 30]) {
    const snippet = needle.slice(0, size);
    start = content.indexOf(snippet);
    if (start >= 0) {
      length = snippet.length;
      break;
    }
  }
  if (start < 0 || !positions[start + length - 1]) return;
  const first = positions[start];
  const last = positions[start + length - 1];
  const range = document.createRange();
  range.setStart(first.node, first.offset);
  range.setEnd(last.node, last.offset + 1);
  if (registry && HighlightConstructor)
    registry.set("evidence", new HighlightConstructor(range));
  const scroller = root.closest<HTMLElement>(".document-scroll");
  if (scroller) {
    // Keep the cited passage near the top of the reader. Centering a chapter
    // heading can leave the previous page under the reading-position marker.
    scroller.scrollTop +=
      range.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top -
      72;
  } else first.node.parentElement?.scrollIntoView({ block: "nearest" });
  return () => {
    registry?.delete("evidence");
  };
}
