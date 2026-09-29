export type WorkspacePlace = "main" | "left" | "right" | "float";
export interface WorkspacePlacement {
  mainId: string;
  companionId?: string;
  comparisonOpen: boolean;
  side: "left" | "right";
  floatingIds: string[];
}
export interface WorkspaceView {
  mainId?: string;
  comparisonOpen: boolean;
  side: "left" | "right";
}
export function workspaceContent(kind: unknown): { readonly title: string; readonly canFloat: boolean } | undefined;
export function navigateFloatingContent(current: WorkspacePlacement, fromId: string, targetId: string, mainHidden?: boolean): WorkspacePlacement;
export function workspaceContentLocation(current: WorkspacePlacement, targetId: string): WorkspacePlace | undefined;
export function revealWorkspaceContent(current: WorkspacePlacement, targetId: string, preferred?: WorkspacePlace, mainHidden?: boolean, fallbackMainId?: string): WorkspacePlacement;
export function placeWorkspaceContent(current: WorkspacePlacement, targetId: string, position: WorkspacePlace, fallbackMainId?: string): WorkspacePlacement;
export function validWorkspaceViews(value: unknown): Record<string, WorkspaceView>;
