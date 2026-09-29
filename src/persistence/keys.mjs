// Storage addresses are compatibility contracts, not UI vocabulary. Keep their
// original spelling when renaming product concepts or reorganizing modules.
export const persistenceVersions = Object.freeze({ workspace: 1, projects: 2 });
export const persistenceKeys = Object.freeze({
  workspace: "sidereader:workspace:v1",
  theme: "sidereader:theme:v1",
  projects: "sidereader:projects:v2",
  treeCollapsed: "sidereader:tree-collapsed:v1",
  treeExpansion: "sidereader:paper-tree-expansion:v2",
  studyOpen: "sidereader:study-open:v1",
  companions: "sidereader:companions:v1",
  conversationVisits: "sidereader:conversation-visits:v1",
  referencePages: "sidereader:reference-pages:v1",
  workspaceViews: "sidereader:workspace-views:v1",
  splitRatio: "sidereader:split-ratio:v1",
  pdf: (sourceId) => `sidereader:pdf:${sourceId}`,
  draft: (conversationId) => `sidereader:draft:${conversationId}`,
  conceptDraft: (conversationId) => `sidereader:concept-draft:${conversationId}`,
  questionDraft: (conversationId) => `sidereader:question-draft:${conversationId}`,
});
