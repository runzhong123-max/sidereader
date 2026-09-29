import { objectDropPosition } from "./object-transfer.mjs";

export const WORKSPACE_POINTER_EVENT = "sidereader:workspace-pointer-transfer";
const kinds = new Set(["paper", "object", "card"]);
const validPoint = (point) => point && [point.pointerId, point.x, point.y].every(Number.isFinite);

/** Local pointer transport carries the same identity as native drag data. */
export function createWorkspacePointerTransfer(identity, start, publish) {
  if (!identity?.projectId || !identity.nodeId || identity.nodeId.length > 512 ||
    !kinds.has(identity.kind) || !validPoint(start)) return;
  let active = true, moved = false, last = start;
  const emit = (phase) => publish({ ...identity, phase, x: last.x, y: last.y });
  const accepts = (point) => active && validPoint(point) && point.pointerId === start.pointerId;
  return {
    move(point) {
      if (!accepts(point)) return false;
      last = point;
      moved ||= Math.hypot(point.x - start.x, point.y - start.y) > 5;
      if (moved) emit("move");
      return moved;
    },
    finish(point) {
      if (!accepts(point)) return;
      last = point;
      moved ||= Math.hypot(point.x - start.x, point.y - start.y) > 5;
      active = false;
      if (moved) emit("drop");
      return moved;
    },
    cancel() {
      if (!active) return false;
      active = false;
      if (moved) emit("cancel");
      return moved;
    },
  };
}

/** Out-of-workspace releases cancel; native and pointer transfers share zones. */
export function workspacePointerPosition(update, projectId, rect) {
  if (!update || update.projectId !== projectId || !["move", "drop"].includes(update.phase) ||
    typeof update.nodeId !== "string" || !update.nodeId || update.nodeId.length > 512 ||
    !kinds.has(update.kind) || !rect ||
    ![update.x, update.y, rect.left, rect.top, rect.width, rect.height].every(Number.isFinite) ||
    rect.width <= 0 || rect.height <= 0) return;
  const x = update.x - rect.left, y = update.y - rect.top;
  if (x < 0 || y < 0 || x > rect.width || y > rect.height) return;
  return objectDropPosition(x, rect.width, update.kind, undefined, y, rect.height);
}
