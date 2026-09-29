import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
const configPath = resolve(".local/config.json");
let saved = {};
try {
  saved = JSON.parse(readFileSync(configPath, "utf8"));
} catch {}
let config = {
  baseUrl: process.env.LLM_BASE_URL || "https://api.deepseek.com",
  model: process.env.LLM_MODEL || "deepseek-flash",
  apiKey: process.env.LLM_API_KEY || "",
  embeddingBaseUrl: process.env.EMBEDDING_BASE_URL || "",
  embeddingModel: process.env.EMBEDDING_MODEL || "",
  embeddingKey: process.env.EMBEDDING_API_KEY || "",
  ...saved,
};
export const isConfigured = () => Boolean(config.apiKey && config.model);
export const hasEmbedding = () =>
  Boolean(
    config.embeddingBaseUrl && config.embeddingModel && config.embeddingKey,
  );
export function publicConfig() {
  const { apiKey, embeddingKey, ...safe } = config;
  return {
    ...safe,
    configured: isConfigured(),
    embeddingConfigured: hasEmbedding(),
  };
}
function validBase(value) {
  const u = new URL(value);
  if (
    u.protocol !== "https:" &&
    !(
      u.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)
    )
  )
    throw new Error("接口地址必须使用 HTTPS，本地服务可使用 HTTP。");
  if (u.username || u.password || u.search || u.hash)
    throw new Error("接口地址不能包含凭证、查询参数或片段。");
  return value.replace(/\/$/, "");
}
export function saveConfig(input) {
  const next = { ...config };
  for (const key of ["baseUrl", "model", "embeddingBaseUrl", "embeddingModel"])
    if (typeof input[key] === "string") next[key] = input[key].trim();
  for (const key of ["apiKey", "embeddingKey"])
    if (typeof input[key] === "string" && input[key].trim())
      next[key] = input[key].trim();
  next.baseUrl = validBase(next.baseUrl);
  if (next.embeddingBaseUrl)
    next.embeddingBaseUrl = validBase(next.embeddingBaseUrl);
  if (!next.model || next.model.length > 200)
    throw new Error("请填写有效的模型 ID。");
  mkdirSync(resolve(".local"), { recursive: true, mode: 0o700 });
  writeFileSync(configPath + ".tmp", JSON.stringify(next, null, 2), {
    mode: 0o600,
  });
  renameSync(configPath + ".tmp", configPath);
  config = next;
  vectorCache.clear();
  return publicConfig();
}
export async function completion(messages, json = false, options = {}) {
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      temperature: 0.3,
      max_tokens: options.maxTokens || 4500,
      ...(json ? { response_format: { type: "json_object" } } : {}),
      ...(config.baseUrl.includes("api.deepseek.com")
        ? { thinking: { type: "disabled" } }
        : {}),
    }),
    signal: options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(90000)])
      : AbortSignal.timeout(90000),
  });
  if (!response.ok)
    throw new Error(
      `模型服务返回 ${response.status}，请检查接口地址、模型与 API Key。`,
    );
  const data = await response.json();
  options.onUsage?.(data.usage);
  if (!data.choices?.[0]?.message?.content)
    throw new Error("模型没有返回内容。");
  return data.choices[0].message.content;
}
export async function recognize(image, signal) {
  if (!isConfigured())
    throw new Error("扫描页面需要识别，请先在模型设置中连接 DeepSeek。");
  return completion(
    [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "请准确转录这一页文档的全部文字，按自然阅读顺序输出 Markdown，保留标题、段落、公式和表格。对图表用简短的 [图示描述：...] 说明可见内容，不要补充或猜测不可见内容。只返回文档内容。",
          },
          { type: "image_url", image_url: { url: image } },
        ],
      },
    ],
    false,
    { signal },
  );
}
const vectorCache = new Map();
async function embed(input, signal) {
  const r = await fetch(`${config.embeddingBaseUrl}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.embeddingKey}`,
    },
    body: JSON.stringify({ model: config.embeddingModel, input }),
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(60000)])
      : AbortSignal.timeout(60000),
  });
  if (!r.ok) throw new Error(`Embedding 服务返回 ${r.status}`);
  const data = await r.json();
  const entries = data.data?.sort((a, b) => a.index - b.index);
  if (
    entries?.length !== input.length ||
    entries.some(
      (e) =>
        !Array.isArray(e.embedding) ||
        !e.embedding.length ||
        e.embedding.some((v) => !Number.isFinite(v)),
    )
  )
    throw new Error("Embedding 服务返回的向量格式不正确");
  return entries.map((e) => e.embedding);
}
const digest = (t) => createHash("sha256").update(t).digest("hex");
export async function semanticSearch(chunks, query, signal) {
  if (!hasEmbedding() || !chunks.length) return [];
  const keys = chunks.map((c) => digest(c.text));
  const missing = [
    ...new Map(chunks.map((c, i) => [keys[i], c.text])).entries(),
  ].filter(([key]) => !vectorCache.has(key));
  for (let i = 0; i < missing.length; i += 32) {
    const batch = missing.slice(i, i + 32);
    const vectors = await embed(
      batch.map(([, t]) => t),
      signal,
    );
    batch.forEach(([key], j) => vectorCache.set(key, vectors[j]));
  }
  const [q] = await embed([query], signal);
  const norm = (v) => Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  const qn = norm(q);
  const ranked = chunks
    .map((c, i) => {
      const v = vectorCache.get(keys[i]);
      if (v?.length !== q.length) throw new Error("Embedding 向量维度不一致");
      return {
        ...c,
        score: v.reduce((s, x, j) => s + x * q[j], 0) / (norm(v) * qn || 1),
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
  if (vectorCache.size > 20000) vectorCache.clear();
  return ranked;
}
