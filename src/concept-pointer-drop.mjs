/** Both graph presentations deliver references through the same Tutor event. */
export function conceptDropTarget(projectId, x, y, excludedRoot, hitTest = globalThis.document) {
  if (!projectId) return null;
  const hit = hitTest?.elementFromPoint(x, y);
  if (!hit || excludedRoot?.contains(hit)) return null;
  const target = hit.closest("[data-concept-drop]");
  return target?.getAttribute("data-concept-drop") === projectId ? target : null;
}

export function markConceptDropTarget(previous, next) {
  if (previous !== next) {
    previous?.removeAttribute("data-concept-drag-over");
    next?.setAttribute("data-concept-drag-over", "true");
  }
  return next;
}

export function deliverConceptDrop(target, projectId, conceptId) {
  if (!target || target.getAttribute("data-concept-drop") !== projectId) return false;
  target.dispatchEvent(new CustomEvent("sidereader:concept-drop", {
    bubbles: true, detail: { version: 1, projectId, kind: "concept", conceptId },
  }));
  return true;
}
