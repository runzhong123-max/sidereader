import type { ResearchStep } from "../types";
import { readTutorStream } from "./tutor-stream.mjs";
import { readJsonResponse } from "./http-response.mjs";

export async function tutorRequest<T>(body: unknown, onProgress: (step: ResearchStep) => void, signal: AbortSignal): Promise<T> {
  const response = await fetch("/api/tutor", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...(body as object), stream: true }),
    signal,
  });
  if (!response.ok) {
    await readJsonResponse(response, signal, "研究服务暂不可用。");
  }
  return readTutorStream<T>(response.body, onProgress);
}
