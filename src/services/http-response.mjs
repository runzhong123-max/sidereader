/** Decode API responses without turning invalid bodies or cancellation into success. */
export async function readJsonResponse(response, signal, errorMessage = "请求失败，请重试。") {
  signal?.throwIfAborted();
  let data;
  try {
    data = await response.json();
  } catch (error) {
    signal?.throwIfAborted();
    if (error?.name === "AbortError") throw error;
    throw new Error("服务返回的内容无法识别，请确认本地服务正在运行。");
  }
  signal?.throwIfAborted();
  if (!response.ok) {
    const message = typeof data?.error === "string" && data.error.trim() ? data.error : errorMessage;
    throw new Error(message);
  }
  return data;
}
