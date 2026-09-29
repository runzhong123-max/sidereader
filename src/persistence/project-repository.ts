import { get, set, del } from "idb-keyval";
import type { ProjectStore, Workspace } from "../types";
import { persistenceKeys } from "./keys.mjs";

// These are durable records: do not swallow read or write errors and never
// replace an unreadable project with defaults. Loading/migration is separate.
export const loadWorkspace = () => get<Workspace>(persistenceKeys.workspace);
export const saveWorkspace = (workspace: Workspace) => set(persistenceKeys.workspace, workspace);
export const loadProjects = () => get<ProjectStore>(persistenceKeys.projects);
export const saveProjects = (store: ProjectStore) => set(persistenceKeys.projects, store);
export const readPdf = (sourceId: string) => get<ArrayBuffer>(persistenceKeys.pdf(sourceId));
export const savePdf = (sourceId: string, data: ArrayBuffer) => set(persistenceKeys.pdf(sourceId), data);
export const removePdf = (sourceId: string) => del(persistenceKeys.pdf(sourceId));
