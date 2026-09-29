import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

let mock, child, folder, base;
let started, closed;
const calls = [];
const body = {
  scope: { kind: "chapter", title: "模型评估" },
  chunks: [{ id: "book:1:0", sourceId: "book", title: "机器学习", page: 1, text: "训练误差是训练集上的误差。" }],
};
before(async () => {
  folder = await mkdtemp(join(tmpdir(), "sidereader-graph-test-"));
  mock = http.createServer(async (req, res) => {
    let raw = "";
    for await (const part of req) raw += part;
    const input = JSON.parse(raw);
    calls.push(input);
    const context = JSON.parse(input.messages[1].content);
    if (context.scope.title === "cancel-test") {
      res.once("close", () => closed?.());
      started?.();
      return;
    }
    res.setHeader("Content-Type", "application/json");
    const nodes = context.scope.title === "later-chunk-test" ? [
      { id: "feedback", name: "反馈闭环", description: "根据工具观察结果调整下一步行动。", citations: [context.evidence.length], links: [] },
    ] : [
      { id: "training-error", name: "训练误差", description: "训练集上的误差。", citations: [1], links: [] },
    ];
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ nodes }) } }] }));
  });
  await new Promise((done) => mock.listen(0, "127.0.0.1", done));
  const reserve = http.createServer();
  await new Promise((done) => reserve.listen(0, "127.0.0.1", done));
  const port = reserve.address().port;
  await new Promise((done) => reserve.close(done));
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [resolve("server/index.mjs")], {
    cwd: folder,
    env: { ...process.env, PORT: String(port), LLM_API_KEY: "test-only-graph-key",
      LLM_BASE_URL: `http://127.0.0.1:${mock.address().port}`, LLM_MODEL: "stub-graph" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((done, reject) => {
    const timer = setTimeout(() => reject(new Error("Graph API startup timed out")), 10000);
    child.stdout.once("data", () => { clearTimeout(timer); done(); });
    child.once("exit", () => { clearTimeout(timer); reject(new Error("Graph API exited")); });
  });
});
after(async () => {
  child?.kill();
  mock?.closeAllConnections();
  if (mock) await new Promise((done) => mock.close(done));
  if (folder) await rm(folder, { recursive: true, force: true });
});
const post = (value = body, options = {}) => fetch(base + "/api/knowledge-graph", {
  method: "POST", headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  body: JSON.stringify(value), signal: options.signal,
});
const bounded = (promise) => {
  let timeout;
  return Promise.race([promise, new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error("Graph cancellation timed out")), 3000);
  })]).finally(() => clearTimeout(timeout));
};

test("graph endpoint calls the model once and rejects cross-origin or empty requests", async () => {
  const initial = calls.length;
  assert.equal((await post(body, { headers: { Origin: "https://untrusted.example" } })).status, 403);
  assert.equal((await post({ ...body, chunks: [] })).status, 422);
  assert.equal(calls.length, initial);
  const response = await post();
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(calls.length, initial + 1);
  assert.equal(calls.at(-1).max_tokens, 3500);
  assert.deepEqual(calls.at(-1).response_format, { type: "json_object" });
  assert.equal(result.sampledPages, 1);
  assert.equal(result.totalPages, 1);
  assert.equal(result.sampledChunks, 1);
  assert.equal(result.totalChunks, 1);
  assert.equal(result.sampledCharacters, body.chunks[0].text.length);
  assert.equal(result.totalCharacters, body.chunks[0].text.length);
  assert.equal(result.truncated, false);
  assert.equal(result.concepts[0].anchors[0].sourceId, "book");
});

test("graph endpoint preserves late same-page evidence and returns sampling metadata", async () => {
  const initial = calls.length;
  const chunks = [
    { id: "book:15:0", sourceId: "book", title: "Agent", page: 15, text: "模型根据上下文推理。".repeat(200) },
    { id: "book:15:1", sourceId: "book", title: "Agent", page: 15, text: "工具执行行动并观察外部环境。" },
    { id: "book:15:2", sourceId: "book", title: "Agent", page: 15, text: "反馈闭环通过工具观察结果调整下一步行动。" },
  ];
  const response = await post({ scope: { kind: "chapter", title: "later-chunk-test" }, chunks });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(calls.length, initial + 1);
  const evidence = JSON.parse(calls.at(-1).messages[1].content).evidence;
  assert.deepEqual(evidence.map((entry) => entry.id), chunks.map((entry) => entry.id));
  assert.equal(result.sampledPages, 1);
  assert.equal(result.totalPages, 1);
  assert.equal(result.sampledChunks, 3);
  assert.equal(result.totalChunks, 3);
  assert.equal(result.truncated, false);
  assert.equal(result.concepts[0].anchors[0].page, 15);
  assert.equal(result.concepts[0].anchors[0].quote, chunks[2].text);
});

test("closing graph generation aborts its upstream request", async () => {
  const start = new Promise((resolve) => { started = resolve; });
  const close = new Promise((resolve) => { closed = resolve; });
  const controller = new AbortController();
  const request = post({ ...body, scope: { kind: "project", title: "cancel-test" } }, { signal: controller.signal });
  try {
    await bounded(start);
    controller.abort();
    await assert.rejects(request, { name: "AbortError" });
    await bounded(close);
  } finally {
    controller.abort();
    started = closed = undefined;
  }
});
