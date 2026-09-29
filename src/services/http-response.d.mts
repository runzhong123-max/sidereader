export function readJsonResponse<T>(response: Pick<Response, "ok" | "json">, signal?: AbortSignal, errorMessage?: string): Promise<T>;
