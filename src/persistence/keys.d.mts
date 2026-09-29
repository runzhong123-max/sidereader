export const persistenceVersions: Readonly<{ workspace: 1; projects: 2 }>;
export const persistenceKeys: Readonly<{
  workspace: string;
  theme: string;
  projects: string;
  treeCollapsed: string;
  treeExpansion: string;
  studyOpen: string;
  companions: string;
  conversationVisits: string;
  referencePages: string;
  workspaceViews: string;
  splitRatio: string;
  pdf: (sourceId: string) => string;
  draft: (conversationId: string) => string;
  conceptDraft: (conversationId: string) => string;
  questionDraft: (conversationId: string) => string;
}>;
