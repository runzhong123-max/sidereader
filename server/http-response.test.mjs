import test from "node:test";
import assert from "node:assert/strict";
import { readJsonResponse } from "../src/services/http-response.mjs";

test("successful JSON responses preserve data, including empty bootstrap data", async () => {
  assert.deepEqual(await readJsonResponse(Response.json({ configured: true })), { configured: true });
  assert.equal(await readJsonResponse(Response.json(null)), null);
});

test("HTTP 200 HTML or malformed JSON reject instead of becoming successful error objects", async () => {
  await assert.rejects(readJsonResponse(new Response("<html>proxy fallback</html>")), /无法识别/);
  await assert.rejects(readJsonResponse(new Response('{"partial":')), /无法识别/);
});

test("API errors preserve server messages and handle non-object errors", async () => {
  await assert.rejects(readJsonResponse(Response.json({ error: "请先配置模型" }, { status: 400 })), /请先配置模型/);
  await assert.rejects(readJsonResponse(Response.json(null, { status: 500 }), undefined, "研究服务暂不可用。"), /研究服务暂不可用/);
  await assert.rejects(readJsonResponse(Response.json({ error: {} }, { status: 500 })), /请求失败/);
});

test("cancelling during body decoding preserves AbortError or the exact abort reason", async () => {
  const abort = new DOMException("request cancelled", "AbortError");
  await assert.rejects(readJsonResponse({ ok: true, json: async () => { throw abort; } }), (error) => error === abort);
  const controller = new AbortController(), reason = new Error("closed workspace");
  const response = { ok: true, json: async () => { controller.abort(reason); throw new SyntaxError("truncated"); } };
  await assert.rejects(readJsonResponse(response, controller.signal), (error) => error === reason);
  const completed = new AbortController();
  await assert.rejects(readJsonResponse({ ok: true, json: async () => { completed.abort(abort); return { answer: "late result" }; } }, completed.signal), (error) => error === abort);
});
