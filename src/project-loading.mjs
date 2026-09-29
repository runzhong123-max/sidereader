import { persistenceVersions } from "./persistence/keys.mjs";

function isWorkspace(value) {
  return (
    value &&
    typeof value.name === "string" &&
    ["sources", "concepts", "stages", "sets"].every((key) =>
      Array.isArray(value[key]),
    )
  );
}
function isStore(value) {
  return (
    value?.version === persistenceVersions.projects &&
    Array.isArray(value.projects) &&
    value.projects.length > 0 &&
    value.projects.every(
      (p) =>
        isWorkspace(p) &&
        typeof p.id === "string" &&
        Array.isArray(p.chats) &&
        Array.isArray(p.tabs) &&
        p.tabs.length > 0,
    )
  );
}
// Existing data always wins. Read errors or unknown schemas must never become a
// successful empty load, because the caller would then save over that data.
export async function loadInitialProjects({
  loadProjects,
  loadWorkspace,
  bootstrap,
  seed,
}) {
  const saved = await loadProjects();
  if (saved != null) {
    if (!isStore(saved))
      throw new Error("本机项目格式无法识别，已保留原数据。");
    return saved;
  }
  const legacy = await loadWorkspace();
  if (legacy != null) {
    if (legacy.version !== persistenceVersions.workspace || !isWorkspace(legacy))
      throw new Error("旧版项目格式无法识别，已保留原数据。");
    const p = { ...seed(), ...legacy };
    return { version: persistenceVersions.projects, projects: [p], activeProjectId: p.id };
  }
  const initial = await bootstrap().catch(() => null);
  if (isStore(initial)) return initial;
  const p = seed();
  return { version: persistenceVersions.projects, projects: [p], activeProjectId: p.id };
}
