// Merge only fields owned by the proposal; user layout and completion survive.
export function mergeProjectUpdate(project, proposal) {
  const concepts = [...project.concepts];
  const idMap = new Map();
  for (const node of proposal.concepts || []) {
    const previous = concepts.find(
      (c) => c.id === node.id || c.name === node.name,
    );
    idMap.set(node.id, previous?.id || node.id);
  }
  for (const node of proposal.concepts || []) {
    const id = idMap.get(node.id);
    const i = concepts.findIndex((c) => c.id === id);
    const next = {
      ...node,
      id,
      links: node.links.map((x) => idMap.get(x) || x).filter((x) => x !== id),
    };
    if (i >= 0)
      concepts[i] = {
        ...concepts[i],
        ...next,
        x: concepts[i].x,
        y: concepts[i].y,
        ...(concepts[i].layout ? { layout: concepts[i].layout } : {}),
      };
    else concepts.push(next);
  }
  const stages = [...project.stages];
  const stageIds = new Map(
    (proposal.stages || []).map((s) => [
      s.id,
      stages.find((p) => p.id === s.id || p.title === s.title)?.id || s.id,
    ]),
  );
  for (const stage of proposal.stages || []) {
    const id = stageIds.get(stage.id);
    const i = stages.findIndex((s) => s.id === id);
    const next = {
      ...stage,
      id,
      prerequisites: (stage.prerequisites || [])
        .map((x) => stageIds.get(x) || x)
        .filter((x) => x !== id),
      done: i >= 0 ? stages[i].done : false,
    };
    if (i >= 0) stages[i] = { ...stages[i], ...next };
    else stages.push(next);
  }
  return { ...project, concepts, stages };
}

// Compare persisted values: optional undefined fields disappear during storage.
function equal(a, b) {
  if (a === b) return true;
  if (
    a === null ||
    b === null ||
    typeof a !== "object" ||
    typeof b !== "object"
  )
    return false;
  if (Array.isArray(a) || Array.isArray(b))
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((value, index) => equal(value, b[index]))
    );
  const aKeys = Object.keys(a).filter((key) => a[key] !== undefined);
  const bKeys = Object.keys(b).filter((key) => b[key] !== undefined);
  return (
    aKeys.length === bKeys.length && aKeys.every((key) => equal(a[key], b[key]))
  );
}

function changes(before, after) {
  const previous = new Map(before.map((item) => [item.id, item]));
  return after.flatMap((item) => {
    const original = previous.get(item.id);
    if (equal(original, item)) return [];
    // A receipt owns its snapshots, even if callers later edit project objects.
    return [
      {
        id: item.id,
        ...(original ? { before: structuredClone(original) } : {}),
        after: structuredClone(item),
      },
    ];
  });
}

export function createProjectUpdate(project, proposal) {
  const next = mergeProjectUpdate(project, proposal);
  return {
    project: next,
    receipt: {
      concepts: changes(project.concepts, next.concepts),
      stages: changes(project.stages, next.stages),
    },
  };
}

function revertObjects(items, entries, referenceField) {
  const receipts = new Map(entries.map((entry) => [entry.id, entry]));
  const liveIds = new Set(items.map((item) => item.id));
  const removable = new Set();
  const retained = new Set();
  const restored = items.map((item) => {
    const entry = receipts.get(item.id);
    if (!entry) return item;
    if (!entry.before) {
      if (equal(item, entry.after)) removable.add(item.id);
      else retained.add(item.id);
      return item;
    }
    const next = { ...item };
    for (const key of new Set([
      ...Object.keys(entry.before),
      ...Object.keys(entry.after),
    ])) {
      if (equal(entry.before[key], entry.after[key])) continue;
      if (!equal(item[key], entry.after[key])) continue;
      if (entry.before[key] === undefined) delete next[key];
      else
        next[key] =
          key === referenceField
            ? entry.before[key].filter((id) => liveIds.has(id))
            : structuredClone(entry.before[key]);
    }
    // Count edits which actually survive the undo, including layout and done.
    if (!equal(next, entry.before)) retained.add(item.id);
    return equal(next, item) ? item : next;
  });

  // Only live objects root references. An isolated group of unchanged new
  // objects can disappear together; a later reference retains its whole chain.
  const byId = new Map(restored.map((item) => [item.id, item]));
  const queue = restored.filter((item) => !removable.has(item.id));
  for (let index = 0; index < queue.length; index++) {
    for (const id of queue[index][referenceField] || []) {
      if (!removable.delete(id)) continue;
      retained.add(id);
      queue.push(byId.get(id));
    }
  }
  return {
    items: restored.filter((item) => !removable.has(item.id)),
    retained: retained.size,
  };
}

export function revertProjectUpdate(project, receipt) {
  const concepts = revertObjects(project.concepts, receipt.concepts, "links");
  const stages = revertObjects(project.stages, receipt.stages, "prerequisites");
  return {
    project: { ...project, concepts: concepts.items, stages: stages.items },
    retained: concepts.retained + stages.retained,
  };
}
