import { readPdf, savePdf } from "../persistence/project-repository";

// Imported bytes live in IndexedDB. Seeded books can be restored from the local
// server manifest; this service coordinates the fallback without coupling the
// persistence layer to HTTP or assigning new source identities.
export async function loadPdf(sourceId: string) {
  const local = await readPdf(sourceId);
  if (local) return local;
  const response = await fetch(`/api/books/${encodeURIComponent(sourceId)}`);
  if (!response.ok) return undefined;
  const data = await response.arrayBuffer();
  await savePdf(sourceId, data);
  return data;
}
