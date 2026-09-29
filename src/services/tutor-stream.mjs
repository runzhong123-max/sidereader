// Decode newline-delimited tutor events independently of fetch and UI mounting.
// A result is complete only after the stream ends without a later error.
export async function readTutorStream(stream, onProgress) {
  const reader = stream?.getReader();
  if (!reader) throw new Error("浏览器无法读取研究进展。");
  const decoder = new TextDecoder();
  let buffer = "", result, hasResult = false;
  const consume = (line) => {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.type === "progress") onProgress(event.item);
    if (event.type === "result") { result = event.data; hasResult = event.data !== undefined; }
    if (event.type === "error") throw new Error(event.error);
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let separator;
      while ((separator = buffer.indexOf("\n")) >= 0) {
        consume(buffer.slice(0, separator));
        buffer = buffer.slice(separator + 1);
      }
      if (done) break;
    }
    if (buffer.trim()) consume(buffer);
    if (!hasResult) throw new Error("研究连接中断，未收到完整结果。请重试。");
    return result;
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}
