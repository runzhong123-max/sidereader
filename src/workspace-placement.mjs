import { surfaceDefinition } from "./domain/objects.mjs";

/** Content identity and ownership never change when its place changes. */
export function workspaceContent(kind) {
  if (kind === "book") return { title: "PDF", canFloat: true };
  if (kind === "chat") return { title: "对话", canFloat: true };
  return surfaceDefinition(kind);
}

/** Follow an origin inside a floating view without duplicating visible content. */
export function navigateFloatingContent(current, fromId, targetId, mainHidden = false) {
  if (!targetId || fromId === targetId) return current;
  const floatingIds = (current.floatingIds || []).filter((id) => id !== fromId);
  const alreadyVisible = targetId === current.mainId || (current.comparisonOpen && targetId === current.companionId);
  if (!alreadyVisible && !floatingIds.includes(targetId)) floatingIds.push(targetId);
  return { ...current, floatingIds, comparisonOpen: mainHidden && targetId === current.mainId ? false : current.comparisonOpen };
}

/** Opening content reveals its existing instance before assigning a new place. */
export function workspaceContentLocation(current, targetId) {
  if (targetId === current.mainId) return "main";
  if (current.comparisonOpen && targetId === current.companionId) return current.side;
  if ((current.floatingIds || []).includes(targetId)) return "float";
}

export function revealWorkspaceContent(current, targetId, preferred = "float", mainHidden = false, fallbackMainId) {
  const existing = workspaceContentLocation(current, targetId);
  if (!existing) return placeWorkspaceContent(current, targetId, preferred, fallbackMainId);
  return {
    ...current,
    comparisonOpen: existing === "main" && mainHidden ? false : current.comparisonOpen,
    // Recover duplicate legacy presentations as well as avoiding new ones.
    floatingIds: [...new Set(current.floatingIds || [])].filter((id) => existing === "float" || id !== targetId),
  };
}

export function placeWorkspaceContent(current, targetId, position, fallbackMainId) {
  if (!targetId || !["main", "left", "right", "float"].includes(position)) return current;
  const next = { ...current, floatingIds: [...(current.floatingIds || [])] };
  const hasCompanion = current.comparisonOpen && current.companionId && current.companionId !== current.mainId;
  if (position === "float") {
    if (targetId === current.mainId) {
      const replacement = hasCompanion ? current.companionId
        : typeof fallbackMainId === "string" && fallbackMainId && fallbackMainId !== targetId ? fallbackMainId : undefined;
      // A sole main view needs a real replacement before it can be detached.
      if (!replacement) return current;
      next.mainId = replacement;
      next.comparisonOpen = false;
      next.floatingIds = next.floatingIds.filter((id) => id !== replacement);
    } else if (hasCompanion && targetId === current.companionId) {
      next.comparisonOpen = false;
    }
    if (!next.floatingIds.includes(targetId)) next.floatingIds.push(targetId);
    return next;
  }
  next.floatingIds = next.floatingIds.filter((id) => id !== targetId);
  if (position === "main") {
    if (targetId === current.mainId) return next;
    next.mainId = targetId;
    // Promoting the side pane swaps the two contents, preserving the reference.
    if (hasCompanion && targetId === current.companionId) next.companionId = current.mainId;
    next.comparisonOpen = Boolean(hasCompanion && next.companionId !== next.mainId);
  } else {
    if (targetId === current.mainId) {
      if (!hasCompanion) return next; // Never create two copies of the same pane.
      next.mainId = current.companionId;
    }
    next.companionId = targetId;
    next.comparisonOpen = true;
    next.side = position;
  }
  return next;
}

export function validWorkspaceViews(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([, view]) => view && typeof view === "object" && !Array.isArray(view))
    .map(([id, view]) => [id, {
      mainId: typeof view.mainId === "string" ? view.mainId : undefined,
      comparisonOpen: view.comparisonOpen !== false,
      side: view.side === "left" ? "left" : "right",
    }]));
}
