import type { ResearchStep } from "../types";
export function readTutorStream<T>(stream: ReadableStream<Uint8Array> | null | undefined, onProgress: (step: ResearchStep) => void): Promise<T>;
