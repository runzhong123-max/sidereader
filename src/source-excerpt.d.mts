export type SourceExcerptOptions = { query?: string; maxChars?: number };
export type SourceExcerpt = { markdown: string; truncated: boolean; hasUncertainText: boolean };
/** Preserves paragraphs and source symbols, adding math delimiters only for recognizable complete notation.
 * maxChars is a soft limit that preserves complete math/code/table blocks. Omit for the full text. */
export function prepareSourceExcerpt(text: string, options?: SourceExcerptOptions): SourceExcerpt;
