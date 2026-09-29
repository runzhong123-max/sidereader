/** Place the selection toolbar near the selected endpoint, inside its reader. */
export function selectionToolbarPosition(rects, bounds, { width = 248, height = 40, backwards = false } = {}) {
  const margin = 8;
  const visible = rects.filter((rect) => rect.width > 0 && rect.height > 0 &&
    rect.bottom > bounds.top && rect.top < bounds.bottom && rect.right > bounds.left && rect.left < bounds.right);
  if (!visible.length || bounds.right - bounds.left < width + margin * 2 || bounds.bottom - bounds.top < height + margin * 2) return null;
  const endpoint = backwards ? visible[0] : visible.at(-1);
  const left = Math.max(bounds.left + margin, Math.min((endpoint.left + endpoint.right - width) / 2, bounds.right - width - margin));
  const below = endpoint.bottom + margin;
  const top = below + height <= bounds.bottom - margin ? below : Math.max(bounds.top + margin, endpoint.top - height - margin);
  return { left, top };
}

export function sameBookmarkExcerpt(a, b) {
  return String(a || "").replace(/\s+/g, " ").trim() === String(b || "").replace(/\s+/g, " ").trim();
}
