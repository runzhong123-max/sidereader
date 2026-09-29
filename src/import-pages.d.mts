export interface ImportedPage {
  text: string;
  recognized: boolean;
}
export function processImportPages(
  total: number,
  completed: ImportedPage[],
  readPage: (page: number) => Promise<ImportedPage>,
  signal: AbortSignal,
  onProgress?: (page: number, total: number) => void,
): Promise<ImportedPage[]>;
