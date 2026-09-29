const str = (s, n = 400) => (typeof s === "string" ? s.trim().slice(0, n) : "");
export function maintainObjects(calls, evidence, state = {}) {
  const concepts = [],
    stages = [],
    errors = [];
  const existingConcepts = Array.isArray(state.concepts) ? state.concepts : [];
  const existingStages = Array.isArray(state.stages) ? state.stages : [];
  const references = (row, key, previous) => {
    // Omission is a partial update, not permission to erase existing edges.
    if (!Object.hasOwn(row, key))
      return Array.isArray(previous?.[key]) ? [...previous[key]] : [];
    if (!Array.isArray(row[key])) {
      errors.push("关联字段必须是数组；无效字段已保留原值。");
      return Array.isArray(previous?.[key]) ? [...previous[key]] : [];
    }
    return row[key].filter((id) => typeof id === "string").slice(0, 8);
  };
  const anchors = (row) =>
    [...new Set(Array.isArray(row.citations) ? row.citations : [])]
      .filter((n) => Number.isInteger(n) && evidence[n - 1])
      .slice(0, 4)
      .map((n) => {
        const e = evidence[n - 1];
        return {
          sourceId: e.sourceId,
          page: e.page,
          title: e.title,
          quote: e.text.slice(0, 220),
        };
      });
  for (const call of (Array.isArray(calls) ? calls : []).slice(0, 2)) {
    if (call?.tool === "maintain_graph")
      for (const row of (Array.isArray(call.nodes) ? call.nodes : []).slice(
        0,
        20,
      )) {
        if (
          !row ||
          !str(row.id, 100) ||
          !str(row.name, 100) ||
          !anchors(row).length
        ) {
          errors.push("概念缺少名称、ID或有效原文引用，已忽略。");
          continue;
        }
        if (concepts.some((c) => c.id === str(row.id, 100))) continue;
        const previous = existingConcepts.find(
          (c) => c.id === str(row.id, 100) || c.name === str(row.name, 100),
        );
        concepts.push({
          id: str(row.id, 100),
          name: str(row.name, 100),
          description: str(row.description, 1000),
          links: references(row, "links", previous),
          anchors: anchors(row),
          x: 12 + (concepts.length % 4) * 25,
          y: 12 + Math.floor(concepts.length / 4) * 18,
          group: 0,
        });
      }
    else if (call?.tool === "maintain_path")
      for (const row of (Array.isArray(call.stages) ? call.stages : []).slice(
        0,
        10,
      )) {
        if (
          !row ||
          !str(row.id, 100) ||
          !str(row.title, 120) ||
          !str(row.deliverable) ||
          !str(row.check) ||
          !anchors(row).length
        ) {
          errors.push("关卡缺少产物、验收或有效阅读位置，已忽略。");
          continue;
        }
        if (stages.some((s) => s.id === str(row.id, 100))) continue;
        const previous = existingStages.find(
          (s) => s.id === str(row.id, 100) || s.title === str(row.title, 120),
        );
        stages.push({
          id: str(row.id, 100),
          title: str(row.title, 120),
          description: str(row.description, 1000),
          deliverable: str(row.deliverable),
          check: str(row.check),
          tag: str(row.tag, 40) || "学习",
          done: false,
          prerequisites: references(row, "prerequisites", previous),
          anchors: anchors(row),
        });
      }
  }
  const conceptIds = new Map(
    concepts.map((c) => [
      c.id,
      existingConcepts.find((p) => p.id === c.id || p.name === c.name)
        ?.id || c.id,
    ]),
  );
  concepts.forEach((c) => {
    c.id = conceptIds.get(c.id);
    c.links = c.links.map((id) => conceptIds.get(id) || id);
  });
  const stageIds = new Map(
    stages.map((s) => [
      s.id,
      existingStages.find((p) => p.id === s.id || p.title === s.title)
        ?.id || s.id,
    ]),
  );
  stages.forEach((s) => {
    s.id = stageIds.get(s.id);
    s.prerequisites = s.prerequisites.map((id) => stageIds.get(id) || id);
  });
  const ids = new Set(
    [...concepts, ...existingConcepts].map((c) => c.id),
  );
  concepts.forEach(
    (c) => (c.links = c.links.filter((id) => ids.has(id) && id !== c.id)),
  );
  // Keep only acyclic dependency edges, including the existing project graph.
  const graph = new Map(
    existingStages.map((s) => [s.id, s.prerequisites || []]),
  );
  stages.forEach((s) => graph.set(s.id, []));
  const reaches = (from, to, seen = new Set()) =>
    from === to ||
    (!seen.has(from) &&
      (seen.add(from),
      (graph.get(from) || []).some((x) => reaches(x, to, seen))));
  stages.forEach((s) => {
    s.prerequisites = s.prerequisites.filter((id) => {
      if (!graph.has(id) || reaches(id, s.id)) {
        errors.push("无效或循环的关卡依赖已移除。");
        return false;
      }
      graph.get(s.id).push(id);
      return true;
    });
  });
  return { concepts, stages, warnings: [...new Set(errors)] };
}
