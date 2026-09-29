import { readJsonResponse } from "./http-response.mjs";

export async function api<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, body !== undefined ? {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  } : { signal });
  return readJsonResponse<T>(response, signal);
}
