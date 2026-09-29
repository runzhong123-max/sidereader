/** Canonical objects actually used by a proposal, including no-op aliases. */
export function canonicalProposalReferences(project, proposal, receipt) {
  const references = { concepts: [], stages: [] };
  for (const [field, nameField] of [["concepts", "name"], ["stages", "title"]]) {
    const live = project[field] || [];
    const ids = new Set();
    for (const object of proposal?.[field] || []) {
      const canonical = live.find((item) => item.id === object.id || item[nameField] === object[nameField]);
      if (canonical) ids.add(canonical.id);
    }
    for (const entry of receipt?.[field] || []) if (live.some((item) => item.id === entry.id)) ids.add(entry.id);
    references[field] = [...ids];
  }
  return references;
}
