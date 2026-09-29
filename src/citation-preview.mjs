/** Keep a nearby source preview visible in narrow panes and near viewport edges. */
export function citationPreviewPosition(anchor, viewport, size) {
  const margin = Math.min(12, viewport.width / 4, viewport.height / 4);
  const width = Math.min(size.width, Math.max(0, viewport.width - margin * 2));
  const height = Math.min(size.height, Math.max(0, viewport.height - margin * 2));
  const minLeft = viewport.left + margin;
  const maxLeft = viewport.left + viewport.width - width - margin;
  const minTop = viewport.top + margin;
  const maxTop = viewport.top + viewport.height - height - margin;
  const below = anchor.bottom + 8;
  const above = anchor.top - height - 8;
  return {
    left: Math.max(minLeft, Math.min(anchor.left, maxLeft)),
    top: Math.max(minTop, Math.min(below <= maxTop ? below : above, maxTop)),
    width,
    maxHeight: Math.max(0, viewport.height - margin * 2),
  };
}
