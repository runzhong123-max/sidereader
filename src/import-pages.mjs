// Commit one completed page at a time. Failed or cancelled work can resume
// without paying to recognize pages that have already completed.
export async function processImportPages(
  total,
  completed,
  readPage,
  signal,
  onProgress,
) {
  for (let page = completed.length + 1; page <= total; page++) {
    signal.throwIfAborted();
    onProgress?.(page, total);
    const result = await readPage(page);
    signal.throwIfAborted();
    completed.push(result);
  }
  return completed;
}
