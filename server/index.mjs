import "dotenv/config";
import express from "express";
import { resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { research } from "./research.mjs";
import { responseSignal } from "./request-signal.mjs";
import { generateKnowledgeGraph } from "./graph-generation.mjs";
import {
  completion,
  isConfigured,
  hasEmbedding,
  publicConfig,
  saveConfig,
  recognize,
  semanticSearch,
} from "./providers.mjs";
import { PROMPT_VERSION } from "./tutor-context.mjs";
const app = express();
app.use(express.json({ limit: "18mb" }));
// Local app: reject cross-origin mutations and DNS-rebinding hosts.
app.use("/api", (req, res, next) => {
  const hostname = req.hostname;
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname))
    return res.status(403).json({ error: "仅允许本机访问。" });
  const origin = req.headers.origin;
  const trustedOrigins = new Set([
    `http://${req.headers.host}`,
    `https://${req.headers.host}`,
    process.env.UI_ORIGIN || "http://127.0.0.1:5173",
  ]);
  if (origin && !trustedOrigins.has(origin))
    return res.status(403).json({ error: "不允许跨来源请求。" });
  next();
});
app.get("/api/bootstrap", (_, res) => {
  const path = resolve(".local/bootstrap.json");
  if (!existsSync(path)) return res.json(null);
  try {
    res.json(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    res.status(500).json({ error: "本地资料索引读取失败。" });
  }
});
app.get("/api/books/:id", (req, res) => {
  const manifest = resolve(".local/books/manifest.json");
  try {
    const files = JSON.parse(readFileSync(manifest, "utf8"));
    const filename = files[req.params.id];
    if (typeof filename !== "string" || !/^[a-z0-9-]+\.pdf$/.test(filename))
      return res.status(404).json({ error: "原文件不存在。" });
    res.sendFile(resolve(".local/books", filename), { dotfiles: "allow" });
  } catch {
    res.status(404).json({ error: "原文件不存在。" });
  }
});
app.get("/api/status", (_, res) => res.json(publicConfig()));
app.post("/api/config", (req, res) => {
  try {
    res.json(saveConfig(req.body));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
app.post("/api/config/test", async (_, res) => {
  try {
    if (!isConfigured()) throw new Error("请先保存 API Key。");
    await completion([{ role: "user", content: "Reply with OK." }]);
    res.json({ ok: true });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});
app.post("/api/ocr", async (req, res) => {
  const operation = responseSignal(res);
  try {
    if (
      typeof req.body.image !== "string" ||
      !/^data:image\/(png|jpeg);base64,/.test(req.body.image) ||
      req.body.image.length > 12000000
    )
      return res.status(400).json({ error: "页面图片格式或大小不正确。" });
    const text = await recognize(req.body.image, operation.signal);
    if (!res.destroyed) res.json({ text });
  } catch (e) {
    if (!res.destroyed) res.status(502).json({ error: e.message });
  } finally {
    operation.release();
  }
});
app.post("/api/knowledge-graph", async (req, res) => {
  const operation = responseSignal(res);
  const deadline = new AbortController();
  const timeout = setTimeout(() => deadline.abort(new Error("图谱生成达到时间上限，请稍后重试。")), 90000);
  const signal = AbortSignal.any([operation.signal, deadline.signal]);
  try {
    const result = await generateKnowledgeGraph(req.body, {
      complete: isConfigured() ? completion : null,
      signal,
    });
    if (!res.destroyed) res.json(result);
  } catch (error) {
    if (!res.destroyed) res.status(deadline.signal.aborted ? 504 : error.status || 502).json({
      error: deadline.signal.aborted ? deadline.signal.reason.message : error.message || "图谱生成失败，请稍后重试。",
    });
  } finally {
    clearTimeout(timeout);
    operation.release();
  }
});
app.post("/api/tutor", async (req, res) => {
  const { question, chunks, pageImage } = req.body;
  if (
    typeof question !== "string" ||
    !question.trim() ||
    question.length > 6000 ||
    !Array.isArray(chunks) ||
    chunks.length > 15000 ||
    chunks.some(
      (c) =>
        !c ||
        typeof c.text !== "string" ||
        c.text.length > 100000 ||
        typeof c.id !== "string" ||
        typeof c.sourceId !== "string" ||
        typeof c.title !== "string" ||
        !Number.isInteger(c.page) ||
        c.page < 1,
    )
  )
    return res.status(400).json({ error: "问题或知识块格式不正确。" });
  if (
    pageImage &&
    (typeof pageImage !== "string" ||
      !/^data:image\/jpeg;base64,/.test(pageImage) ||
      pageImage.length > 12000000)
  )
    return res.status(400).json({ error: "页面图像格式无效。" });
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error("研究达到时间上限，请缩小范围后重试。")),
    240000,
  );
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });
  const stream = req.body.stream === true;
  const emit = (event) => {
    if (!res.destroyed) res.write(JSON.stringify(event) + "\n");
  };
  if (stream) {
    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.flushHeaders();
  }
  try {
    const result = await research(req.body, {
      complete: isConfigured() ? completion : null,
      semantic: hasEmbedding() ? semanticSearch : null,
      signal: controller.signal,
      progress: (item) => {
        if (stream) emit({ type: "progress", item });
      },
    });
    result.promptVersion = PROMPT_VERSION;
    if (stream) {
      emit({ type: "result", data: result });
      res.end();
    } else res.json(result);
  } catch (e) {
    if (!res.destroyed) {
      const error = controller.signal.aborted
        ? "研究已停止或达到时间上限，可缩小范围后重试。"
        : e.message || "研究失败，请稍后重试。";
      if (stream) {
        emit({ type: "error", error });
        res.end();
      } else res.status(502).json({ error });
    }
  } finally {
    clearTimeout(timeout);
  }
});
app.post("/api/github", async (req, res) => {
  const operation = responseSignal(res);
  try {
    const match =
      typeof req.body.url === "string" &&
      req.body.url
        .trim()
        .match(/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/?$/);
    if (!match)
      return res.status(400).json({
        error: "请输入公开仓库首页地址，例如 https://github.com/owner/repo",
      });
    const [, owner, rawRepo] = match;
    const repo = rawRepo.replace(/\.git$/, "");
    const headers = {
      Accept: "application/vnd.github+json",
      ...(process.env.GITHUB_TOKEN
        ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
        : {}),
    };
    async function github(path) {
      operation.signal.throwIfAborted();
      const r = await fetch(
        `https://api.github.com/repos/${owner}/${repo}${path}`,
        {
          headers,
          signal: AbortSignal.any([
            operation.signal,
            AbortSignal.timeout(20000),
          ]),
        },
      );
      if (!r.ok)
        throw new Error(
          r.status === 403 || r.status === 429
            ? "GitHub 请求额度已用完，请稍后重试或配置 GITHUB_TOKEN。"
            : `无法读取仓库（${r.status}），请确认它是公开仓库。`,
        );
      return r.json();
    }
    const meta = await github("");
    const tree = await github(
      `/git/trees/${encodeURIComponent(meta.default_branch)}?recursive=1`,
    );
    const docs = (tree.tree || [])
      .filter(
        (f) =>
          f.type === "blob" &&
          (/\.(md|mdx|txt)$/i.test(f.path) || /(^|\/)readme$/i.test(f.path)) &&
          f.size < 300000 &&
          !/(^|\/)(node_modules|vendor|\.github)\//.test(f.path),
      )
      .sort(
        (a, b) =>
          Number(/^readme/i.test(b.path)) - Number(/^readme/i.test(a.path)) ||
          a.path.length - b.path.length,
      )
      .slice(0, 24);
    if (!docs.length)
      throw new Error("该仓库中没有可处理的 Markdown 或文本文件。");
    const files = [];
    let skipped = 0;
    // Limit concurrent requests and total payload; never execute repository code.
    for (let i = 0; i < docs.length; i += 4) {
      operation.signal.throwIfAborted();
      const batch = await Promise.allSettled(
        docs.slice(i, i + 4).map(async (f) => {
          const blob = await github(`/git/blobs/${f.sha}`);
          return {
            path: f.path,
            text: Buffer.from(blob.content, "base64")
              .toString("utf8")
              .slice(0, 100000),
          };
        }),
      );
      batch.forEach((r) =>
        r.status === "fulfilled" ? files.push(r.value) : skipped++,
      );
    }
    operation.signal.throwIfAborted();
    if (!files.length) throw new Error("仓库文件读取失败，请稍后重试。");
    res.json({
      title: `${owner}/${repo}`,
      url: meta.html_url,
      description: meta.description,
      files,
      skipped,
      limited: docs.length === 24 || Boolean(tree.truncated),
    });
  } catch (e) {
    if (!res.destroyed)
      res.status(502).json({ error: e.message || "仓库导入失败。" });
  } finally {
    operation.release();
  }
});
const dist = resolve("dist");
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get("/{*path}", (_, res) => res.sendFile(resolve(dist, "index.html")));
}
app.use((err, _req, res, _next) =>
  res.status(400).json({
    error:
      err.type === "entity.too.large"
        ? "知识库超过当前请求上限，请减少来源后重试。"
        : "请求格式无效。",
  }),
);
app.listen(Number(process.env.PORT) || 3001, "127.0.0.1", () =>
  console.log(
    `SideReader API http://127.0.0.1:${process.env.PORT || 3001} · ${isConfigured() ? "model connected" : "local retrieval"}`,
  ),
);
