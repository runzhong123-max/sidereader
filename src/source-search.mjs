/** Search whole saved pages, so overlapping retrieval chunks do not duplicate a
 * result or cut a formula in half before the excerpt renderer sees it. */
export function findSourcePages(sources, query, limit = 15) {
  const needle = query.trim().toLowerCase();
  if (!needle || limit <= 0) return [];
  const results = [];
  for (const s of sources) {
    for (let index = 0; index < s.pages.length; index++) {
      const text = s.pages[index];
      if (!(s.title + " " + text).toLowerCase().includes(needle)) continue;
      const page = index + 1;
      results.push({ s, c: { id: `${s.id}:page:${page}`, sourceId: s.id, title: s.title, page, text } });
      if (results.length >= limit) return results;
    }
  }
  return results;
}
