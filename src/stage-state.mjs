import { indexById, hasDirectedPath } from "./domain/relations.mjs";

export function prerequisiteWouldCycle(stages, stageId, prerequisiteId) {
  const byId = indexById(stages);
  return hasDirectedPath(prerequisiteId, stageId, (id) => byId.get(id)?.prerequisites);
}
export function removeStage(project, id) {
  const index = project.stages.findIndex((s) => s.id === id);
  if (index < 0) return project;
  const references = project.stages
    .filter((s) => s.id !== id && s.prerequisites?.includes(id))
    .map((s) => ({
      id: s.id,
      before: [...s.prerequisites],
      after: s.prerequisites.filter((p) => p !== id),
    }));
  return {
    ...project,
    stageRemoval: {
      stage: structuredClone(project.stages[index]),
      index,
      references,
    },
    stages: project.stages
      .filter((s) => s.id !== id)
      .map((s) =>
        s.prerequisites?.includes(id)
          ? { ...s, prerequisites: s.prerequisites.filter((p) => p !== id) }
          : s,
      ),
  };
}
export function restoreRemovedStage(project) {
  const receipt = project.stageRemoval;
  if (!receipt) return project;
  let stages = [...project.stages];
  if (!stages.some((s) => s.id === receipt.stage.id))
    stages.splice(Math.min(receipt.index, stages.length), 0, {
      ...structuredClone(receipt.stage),
      prerequisites: (receipt.stage.prerequisites || []).filter((id) =>
        stages.some((s) => s.id === id),
      ),
    });
  stages = stages.map((s) => {
    const reference = receipt.references.find((r) => r.id === s.id);
    if (
      !reference ||
      JSON.stringify(s.prerequisites || []) !== JSON.stringify(reference.after)
    )
      return s;
    if (prerequisiteWouldCycle(stages, s.id, receipt.stage.id)) return s;
    return {
      ...s,
      prerequisites: reference.before.filter((id) =>
        stages.some((p) => p.id === id),
      ),
    };
  });
  return { ...project, stages, stageRemoval: undefined };
}
