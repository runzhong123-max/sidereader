import type { ReadingSession } from "./reader-viewport.mjs";
export type ReaderSessionSnapshot = ReadingSession & { sourceId?: string; sessionId?: string; transferRevision?: number };
export type ReaderTransferOptions = { navigationKey?: string | number; evidenceText?: string; sourceId?: string };
export interface ReaderSessions {
  get(key?: string): ReaderSessionSnapshot | undefined;
  save(key: string | undefined, snapshot: ReaderSessionSnapshot | undefined): boolean;
  revision(key?: string): number;
  capture(key: string): ReaderSessionSnapshot | undefined;
  restore(key: string, snapshot: ReaderSessionSnapshot | undefined, options?: ReaderTransferOptions): ReaderSessionSnapshot | undefined;
  register(key: string | undefined, capture: () => ReaderSessionSnapshot): () => void;
  subscribe(key: string | undefined, listener: () => void): () => void;
  copy(fromKey: string, toKey: string, options?: ReaderTransferOptions): ReaderSessionSnapshot | undefined;
}
export function createReaderSessions(): ReaderSessions;
export const getReaderSession: ReaderSessions["get"];
export const saveReaderSession: ReaderSessions["save"];
export const readerSessionRevision: ReaderSessions["revision"];
export const registerReaderSession: ReaderSessions["register"];
export const subscribeReaderSession: ReaderSessions["subscribe"];
export const copyReaderSession: ReaderSessions["copy"];
export const captureReaderSession: ReaderSessions["capture"];
export const restoreReaderSession: ReaderSessions["restore"];
