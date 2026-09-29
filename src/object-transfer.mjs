import { QUESTION_DROP_MIME } from "./question-references.mjs";
import { splitBounds } from "./study-layout.mjs";

export const OBJECT_MIME = "application/x-sidereader-object";
export const WORKSPACE_MIME = "application/x-sidereader-workspace";
export const WORKSPACE_PAPER_MIME = "application/x-sidereader-workspace-paper";
export const WORKSPACE_OBJECT_MIME = "application/x-sidereader-workspace-object";
export const WORKSPACE_CARD_MIME = "application/x-sidereader-workspace-card";
const kindMarkers = { paper: WORKSPACE_PAPER_MIME, object: WORKSPACE_OBJECT_MIME, card: WORKSPACE_CARD_MIME };

/** Transfer identities only; receivers resolve content within their own project. */
export function readWorkspacePayload(raw, projectId) {
  try {
    if (typeof raw !== "string" || raw.length > 4096 || !projectId) return;
    const value = JSON.parse(raw);
    const kind = value?.transferKind === undefined ? "object" : value.transferKind;
    if (value?.version === 1 && value.projectId === projectId && value.kind === "workspace" &&
      typeof kind === "string" && Object.hasOwn(kindMarkers, kind) && typeof value.nodeId === "string" && value.nodeId.length > 0 && value.nodeId.length <= 512) {
      return { id: value.nodeId, kind };
    }
  } catch { /* External drags are not workspace references. */ }
}

/** Existing identity-only callers remain compatible with version-one transfers. */
export function readWorkspaceTransfer(raw, projectId) {
  return readWorkspacePayload(raw, projectId)?.id;
}

/** Browsers protect getData during dragover; MIME markers carry presentation intent. */
export function workspaceTransferKind(types) {
  const available = Array.from(types || []);
  if (!available.includes(WORKSPACE_MIME)) return;
  const kinds = Object.entries(kindMarkers).filter(([, mime]) => available.includes(mime)).map(([kind]) => kind);
  return kinds.length === 1 ? kinds[0] : kinds.length === 0 ? "object" : undefined;
}

/** Question titles can either become cards or be cited by a conversation.
 * Keep a conversation reachable before passing the transfer through a window. */
export function shouldPassWorkspaceTransfer(types, acceptsReferences = false) {
  const available = Array.from(types || []);
  return Boolean(workspaceTransferKind(available)) && !(acceptsReferences && available.includes(QUESTION_DROP_MIME));
}

/** Decide from the window's capability, not the current hit target: once a
 * window becomes pointer-transparent the pointer cannot discover its receiver. */
export function shouldPassFloatingTransfer(types, hasReferenceReceiver = false) {
  return shouldPassWorkspaceTransfer(types, hasReferenceReceiver);
}

export function writeWorkspaceTransfer(transfer, projectId, nodeId, title, kind = "object") {
  const safeKind = Object.hasOwn(kindMarkers, kind) ? kind : "object";
  transfer.setData(OBJECT_MIME, JSON.stringify({ version: 1, projectId, kind: "workspace", nodeId, transferKind: safeKind }));
  transfer.setData(WORKSPACE_MIME, "1");
  transfer.setData(kindMarkers[safeKind], "1");
  transfer.setData("text/plain", title);
  transfer.effectAllowed = "copy";
}

/** Every workspace item uses the same visible destinations. Reference receivers
 * handle question/concept transfers before they reach this layout operation. */
export function objectDropPosition(x, width, _kind = "object", canSplit = splitBounds(width, true).canSplit, y, height) {
  if (!Number.isFinite(x) || !Number.isFinite(width) || width <= 0 || x < 0 || x > width) return "main";
  const fraction = x / width;
  if (canSplit && fraction < .24) return "left";
  if (canSplit && fraction > .76) return "right";
  const floatHeight = Math.min(112, height * .24);
  if (Number.isFinite(y) && Number.isFinite(height) && height > 0 && y >= height - floatHeight && y <= height) return "float";
  return "main";
}

/** Pointer-moving a card stays free except at deliberately small docking targets. */
export function cardDockPosition(x, y, width, height, canSplit = splitBounds(width, true).canSplit) {
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0 || x < 0 || y < 0 || x > width || y > height) return null;
  const mainWidth = Math.min(280, width * .5);
  if (y <= 80 && Math.abs(x - width / 2) <= mainWidth / 2) return "main";
  if (canSplit && x <= 64) return "left";
  if (canSplit && width - x <= 64) return "right";
  return null;
}
