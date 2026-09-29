/** Unicode-aware lexical retrieval with reciprocal rank fusion and anchored context. */
export function tokenize(text) {
  const normalized = text.toLowerCase();
  const latin = normalized.match(/[a-z0-9_]+/g) || [];
  const chinese = normalized.match(/[\u3400-\u9fff]+/g) || [];
  return [
    ...latin,
    ...chinese.flatMap((word) =>
      word.length < 2
        ? [word]
        : Array.from({ length: word.length - 1 }, (_, i) =>
            word.slice(i, i + 2),
          ),
    ),
  ];
}
export function retrieve(chunks, query, anchor, variants = []) {
  if (!chunks.length) return [];
  const docs = chunks.map((c) => tokenize(c.text + " " + c.title));
  const average = docs.reduce((n, d) => n + d.length, 0) / docs.length || 1;
  const frequencies = docs.map((d) => {
    const m = new Map();
    d.forEach((t) => m.set(t, (m.get(t) || 0) + 1));
    return m;
  });
  const df = new Map();
  frequencies.forEach((m) =>
    m.forEach((_, t) => df.set(t, (df.get(t) || 0) + 1)),
  );
  const rankings = [query, ...variants].filter(Boolean).map((q) => {
    const terms = [...new Set(tokenize(q))];
    return chunks
      .map((chunk, index) => ({
        chunk,
        score: terms.reduce((s, term) => {
          const tf = frequencies[index].get(term) || 0;
          const idf = Math.log(
            1 +
              (chunks.length - (df.get(term) || 0) + 0.5) /
                ((df.get(term) || 0) + 0.5),
          );
          return (
            s +
            (idf * tf * 2.2) /
              (tf + 1.2 * (0.25 + (0.75 * docs[index].length) / average))
          );
        }, 0),
      }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
  });
  const scores = new Map();
  rankings.forEach((ranking) =>
    ranking.forEach(({ chunk }, i) =>
      scores.set(chunk.id, (scores.get(chunk.id) || 0) + 1 / (60 + i)),
    ),
  );
  if (anchor?.sourceId) {
    chunks
      .filter(
        (c) =>
          c.sourceId === anchor.sourceId && Math.abs(c.page - anchor.page) <= 1,
      )
      .forEach((c) =>
        scores.set(
          c.id,
          (scores.get(c.id) || 0) + (c.page === anchor.page ? 0.025 : 0.008),
        ),
      );
  }
  return chunks
    .filter((c) => scores.has(c.id))
    .sort((a, b) => scores.get(b.id) - scores.get(a.id))
    .slice(0, 6)
    .map((c) => ({ ...c, score: scores.get(c.id) }));
}
