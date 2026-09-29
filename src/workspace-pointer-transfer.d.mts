import type { WorkspaceDropPosition, WorkspaceTransferKind } from "./object-transfer.mjs";

export const WORKSPACE_POINTER_EVENT: string;
export type WorkspacePointerUpdate = {
  projectId: string; nodeId: string; kind: WorkspaceTransferKind;
  phase: "move" | "drop" | "cancel"; x: number; y: number;
};
export type WorkspacePointerPoint = { pointerId: number; x: number; y: number };
export type WorkspacePointerTransfer = {
  move(point: WorkspacePointerPoint): boolean;
  finish(point: WorkspacePointerPoint): boolean | undefined;
  cancel(): boolean;
};
export function createWorkspacePointerTransfer(
  identity: Pick<WorkspacePointerUpdate, "projectId" | "nodeId" | "kind">,
  start: WorkspacePointerPoint,
  publish: (update: WorkspacePointerUpdate) => void,
): WorkspacePointerTransfer | undefined;
export function workspacePointerPosition(update: unknown, projectId: string,
  rect: { left: number; top: number; width: number; height: number } | undefined): WorkspaceDropPosition | undefined;
