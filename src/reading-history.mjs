/** Citation visits are temporary view state, never new papers or saved bookmarks. */
export function createReadingHistory(limit = 20) {
  const visits = new Map();
  return {
    push(projectId, visit) {
      const stack = visits.get(projectId) || [];
      visits.set(projectId, [...stack, structuredClone(visit)].slice(-limit));
    },
    peek(projectId) {
      const visit = visits.get(projectId)?.at(-1);
      return visit ? structuredClone(visit) : undefined;
    },
    take(projectId, available = () => true) {
      const stack = visits.get(projectId) || [];
      while (stack.length) {
        const visit = stack.pop();
        if (available(visit)) return structuredClone(visit);
      }
    },
  };
}
