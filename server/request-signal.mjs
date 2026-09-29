export function responseSignal(response) {
  const controller = new AbortController();
  const close = () => {
    if (!response.writableEnded) controller.abort();
  };
  response.once("close", close);
  return {
    signal: controller.signal,
    release: () => response.off("close", close),
  };
}
