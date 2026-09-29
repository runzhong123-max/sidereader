import type { Project, ProjectStore } from "./types";
export function loadInitialProjects(loaders: {
  loadProjects: () => Promise<unknown>;
  loadWorkspace: () => Promise<unknown>;
  bootstrap: () => Promise<unknown>;
  seed: () => Project;
}): Promise<ProjectStore>;
