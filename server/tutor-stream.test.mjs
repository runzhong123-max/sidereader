import test from "node:test";
import assert from "node:assert/strict";
import { readTutorStream } from "../src/services/tutor-stream.mjs";
const encoder = new TextEncoder();
const stream = (text) => new ReadableStream({ start(controller) {
  // One-byte boundaries exercise both partial JSON lines and multibyte Chinese.
  for (const byte of encoder.encode(text)) controller.enqueue(Uint8Array.of(byte));
  controller.close();
} });

test("stream preserves progress and a final result across UTF-8 and line boundaries", async () => {
  const steps = [];
  const result = await readTutorStream(stream('\n{"type":"progress","item":{"label":"核对原文"}}\n{"type":"result","data":{"answer":"回答"}}'), (item) => steps.push(item));
  assert.deepEqual(steps, [{ label: "核对原文" }]);
  assert.deepEqual(result, { answer: "回答" });
});

test("an interrupted or rejected stream never becomes a successful result", async () => {
  await assert.rejects(readTutorStream(stream('{"type":"progress","item":{}}\n'), () => {}), /未收到完整结果/);
  await assert.rejects(readTutorStream(stream('{"type":"result","data":{}}\n{"type":"error","error":"服务失败"}\n'), () => {}), /服务失败/);
  let cancelled = false;
  const invalid = new ReadableStream({ start(controller) { controller.enqueue(encoder.encode("invalid JSON\n")); }, cancel() { cancelled = true; } });
  await assert.rejects(readTutorStream(invalid, () => {}), SyntaxError);
  assert.equal(cancelled, true);
  assert.equal(invalid.locked, false);
});
