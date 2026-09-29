import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  X,
  Upload,
  Github,
  FileText,
  ArrowRight,
  CheckCircle2,
  Loader2,
  KeyRound,
  Eye,
  EyeOff,
  Link,
} from "lucide-react";
import { api } from "../services/http";
import { savePdf } from "../persistence/project-repository";
import { makeChunks } from "../data";
import { readPdfText } from "../pdf-text.mjs";
import { processImportPages, type ImportedPage } from "../import-pages.mjs";
import type { Source } from "../types";
export function Modal({
  title,
  onClose,
  children,
  wide = false,
  closeLabel = "关闭弹窗",
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  closeLabel?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = dialog.current;
    d?.showModal();
    return () => d?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className={`modal ${wide ? "wide" : ""}`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === dialog.current) {
          const r = dialog.current!.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            onClose();
        }
      }}
    >
      <div className="modal-heading">
        <h2>{title}</h2>
        <button
          className="icon-button"
          aria-label={closeLabel}
          title={closeLabel}
          onClick={onClose}
        >
          <X size={19} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function ImportModal({
  onClose,
  onImport,
  configured,
}: {
  onClose: () => void;
  onImport: (s: Source) => void;
  configured: boolean;
}) {
  const [kind, setKind] = useState<"pdf" | "github">("pdf");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [vision, setVision] = useState(configured);
  const [allPages, setAllPages] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  const checkpoint = useRef<{
    file: File;
    vision: boolean;
    allPages: boolean;
    id: string;
    pages: ImportedPage[];
  } | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function run() {
    if (controller.current) return;
    setError("");
    setBusy(true);
    const request = new AbortController();
    controller.current = request;
    let id: string = crypto.randomUUID();
    try {
      if (kind === "github") {
        setProgress("正在读取仓库目录与学习文档…");
        const result = await api<{
          title: string;
          url: string;
          description: string;
          files: { path: string; text: string }[];
          skipped: number;
          limited: boolean;
        }>("/api/github", { url }, request.signal);
        const pages = result.files.map((f) => `# ${f.path}\n\n${f.text}`);
        const source: Source = {
          id,
          title: result.title,
          author: "GitHub · 公开仓库",
          kind: "github",
          url: result.url,
          description: result.description || "来自 GitHub 的学习资料",
          pages,
          chunks: makeChunks(
            id,
            result.title,
            pages,
            result.files.map((f) => f.path),
          ),
          added: new Date().toISOString(),
          progress: 0,
          color: "blue",
        };
        source.description += ` · 已索引 ${pages.length} 个文档${result.limited ? "（最多 24 个）" : ""}${result.skipped ? `，${result.skipped} 个文件未能读取` : ""}`;
        request.signal.throwIfAborted();
        onImport(source);
      } else {
        if (!file) throw new Error("请选择一个 PDF 文件。");
        if (file.size > 80 * 1024 * 1024)
          throw new Error("当前支持 80 MB 以内的 PDF。");
        if (
          checkpoint.current?.file !== file ||
          checkpoint.current.vision !== vision ||
          checkpoint.current.allPages !== allPages
        )
          checkpoint.current = { file, vision, allPages, id, pages: [] };
        const pending = checkpoint.current;
        id = pending.id;
        setProgress("正在解析 PDF…");
        const { pdfEngine } = await import("../services/pdf-engine");
        const engine = await pdfEngine();
        const data = await file.arrayBuffer();
        request.signal.throwIfAborted();
        const loadingTask = engine.getDocument({
          data: data.slice(0),
          cMapUrl: "/pdfjs/cmaps/",
          cMapPacked: true,
          standardFontDataUrl: "/pdfjs/standard_fonts/",
          wasmUrl: "/pdfjs/wasm/",
        });
        const abortLoading = () => {
          void loadingTask.destroy().catch(() => {});
        };
        request.signal.addEventListener("abort", abortLoading, { once: true });
        try {
          const pdf = await loadingTask.promise;
          if (pdf.numPages > 600)
            throw new Error("当前单份 PDF 最多支持 600 页，请分卷导入。");
          await processImportPages(
            pdf.numPages,
            pending.pages,
            async (p) => {
              const page = await pdf.getPage(p);
              try {
                const content = await readPdfText(page);
                let text = content.items
                  .map((i) =>
                    "str" in i
                      ? i.str + ("hasEOL" in i && i.hasEOL ? "\n" : " ")
                      : "",
                  )
                  .join("")
                  .trim();
                let recognized = false;
                if (
                  vision &&
                  (allPages || text.replace(/\s/g, "").length < 30)
                ) {
                  setProgress(`DeepSeek 正在识别第 ${p} / ${pdf.numPages} 页…`);
                  const base = page.getViewport({ scale: 1 });
                  const viewport = page.getViewport({
                    scale: Math.min(
                      2,
                      1800 / Math.max(base.width, base.height),
                    ),
                  });
                  const canvas = document.createElement("canvas");
                  canvas.width = viewport.width;
                  canvas.height = viewport.height;
                  await page.render({ canvas, viewport }).promise;
                  request.signal.throwIfAborted();
                  const result = await api<{ text: string }>(
                    "/api/ocr",
                    {
                      image: canvas.toDataURL("image/jpeg", 0.88),
                    },
                    request.signal,
                  );
                  text = result.text;
                  recognized = true;
                }
                return { text, recognized };
              } finally {
                page.cleanup();
              }
            },
            request.signal,
            (p, total) => setProgress(`正在处理第 ${p} / ${total} 页…`),
          );
        } finally {
          request.signal.removeEventListener("abort", abortLoading);
          await loadingTask.destroy();
        }
        request.signal.throwIfAborted();
        const pages = pending.pages.map((p) => p.text);
        const recognized = pending.pages.filter((p) => p.recognized).length;
        const empty = pages.filter((text) => !text).length;
        if (empty === pages.length)
          throw new Error(
            "这是一份扫描 PDF。请先连接模型并启用扫描页识别，再重新导入。",
          );
        const title = file.name.replace(/\.pdf$/i, "");
        const source: Source = {
          id,
          title,
          author: "PDF · 本地文档",
          kind: "pdf",
          description: `${pages.length} 页 · ${recognized ? "含 " + recognized + " 页视觉识别" : "已提取文本"}${empty ? ` · ${empty} 个无文字页面未建立索引` : ""}`,
          pages,
          chunks: makeChunks(id, title, pages),
          added: new Date().toISOString(),
          progress: 0,
          color: "sage",
        };
        await savePdf(id, data);
        request.signal.throwIfAborted();
        onImport(source);
        checkpoint.current = null;
      }
    } catch (e) {
      const done = kind === "pdf" ? checkpoint.current?.pages.length || 0 : 0;
      setError(
        `${request.signal.aborted ? "处理已停止。" : e instanceof Error ? e.message : "导入失败，请重试。"}${done ? ` 已保留 ${done} 页处理结果，保持当前文件和识别选项即可继续。` : ""}`,
      );
    } finally {
      controller.current = null;
      setBusy(false);
    }
  }
  return (
    <Modal
      title="添加知识来源"
      closeLabel={busy ? "停止处理" : "关闭弹窗"}
      onClose={() => {
        if (busy) controller.current?.abort();
        else onClose();
      }}
    >
      <p className="modal-intro">
        好问题，始于好材料。把你的下一份灵感放进来。
      </p>
      <>
        <div className="import-tabs">
          <button
            className={kind === "pdf" ? "active" : ""}
            disabled={busy}
            onClick={() => setKind("pdf")}
          >
            <FileText size={17} />
            PDF 文档
          </button>
          <button
            className={kind === "github" ? "active" : ""}
            disabled={busy}
            onClick={() => setKind("github")}
          >
            <Github size={17} />
            GitHub 仓库
          </button>
        </div>
        {kind === "pdf" ? (
          <>
            <input
              ref={fileInput}
              hidden
              type="file"
              accept=".pdf,application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
            <button
              className={`upload-zone ${dragging ? "dragging" : ""}`}
              disabled={busy}
              onClick={() => fileInput.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                if (!busy) setFile(e.dataTransfer.files?.[0] || null);
              }}
            >
              <span className="upload-icon">
                <Upload size={25} strokeWidth={1.4} />
              </span>
              <strong>
                {file ? file.name : "点击选择，或将 PDF 拖到这里"}
              </strong>
              <span>
                {file
                  ? `${(file.size / 1024 / 1024).toFixed(1)} MB`
                  : "支持 PDF · 最大 80 MB / 600 页"}
              </span>
            </button>
            <label className="check-row">
              <input
                type="checkbox"
                checked={vision}
                disabled={!configured || busy}
                onChange={(e) => setVision(e.target.checked)}
              />
              使用 DeepSeek 识别扫描页
              {!configured && <small>需先连接模型</small>}
            </label>
            {vision && (
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={allPages}
                  disabled={busy}
                  onChange={(e) => setAllPages(e.target.checked)}
                />
                识别所有页面中的图表与公式
              </label>
            )}
            {vision && (
              <p className="field-hint">
                需要识别的页面图片会发送至已配置的模型服务，按服务商标准计费。
              </p>
            )}
          </>
        ) : (
          <label className="github-input-label">
            仓库地址
            <div className="input-with-icon">
              <Link size={17} />
              <input
                placeholder="https://github.com/owner/repo"
                value={url}
                disabled={busy}
                onChange={(e) => setUrl(e.target.value)}
              />
            </div>
            <span className="field-hint">
              读取公开仓库的 README 与学习文档，最多 24 个文件。
            </span>
          </label>
        )}
        <div className="import-process">
          <span>解析内容</span>
          <ArrowRight size={12} />
          <span>定位文本块</span>
          <ArrowRight size={12} />
          <span>加入领域知识</span>
        </div>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        {busy && (
          <div className="processing">
            <Loader2 size={15} className="spin" />
            {progress}
            <button
              className="button small"
              onClick={() => controller.current?.abort()}
            >
              停止处理
            </button>
          </div>
        )}
        {kind === "pdf" &&
          (busy || Boolean(checkpoint.current?.pages.length)) && (
            <p className="field-hint">
              停止后可在此继续；关闭弹窗会清除尚未加入的处理进度。
            </p>
          )}
        <footer className="modal-actions">
          <span>保存在当前浏览器，本机可随时继续</span>
          <button
            className="button primary"
            disabled={busy || (kind === "pdf" ? !file : !url.trim())}
            onClick={() => void run()}
          >
            {busy ? <Loader2 size={15} className="spin" /> : <PlusIcon />}
            {busy
              ? "处理中"
              : kind === "pdf" &&
                  checkpoint.current?.file === file &&
                  checkpoint.current.pages.length
                ? "继续处理并添加"
                : "处理并添加"}
          </button>
        </footer>
      </>
    </Modal>
  );
}
function PlusIcon() {
  return <ArrowRight size={15} />;
}
export interface ModelConfig {
  baseUrl: string;
  model: string;
  configured: boolean;
  embeddingBaseUrl: string;
  embeddingModel: string;
  embeddingConfigured: boolean;
}
export function SettingsModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (s: ModelConfig) => void;
}) {
  const [config, setConfig] = useState<ModelConfig>({
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-flash",
    configured: false,
    embeddingBaseUrl: "",
    embeddingModel: "",
    embeddingConfigured: false,
  });
  const [key, setKey] = useState("");
  const [embeddingKey, setEmbeddingKey] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [advanced, setAdvanced] = useState(false);
  useEffect(() => {
    api<ModelConfig>("/api/status")
      .then(setConfig)
      .catch((e) => setError(e.message));
  }, []);
  async function save(test = false) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await api<ModelConfig>("/api/config", {
        ...config,
        apiKey: key,
        embeddingKey,
      });
      setConfig(result);
      setKey("");
      setEmbeddingKey("");
      onSaved(result);
      if (test) {
        await api("/api/config/test", {});
        setMessage("连接成功，模型已准备好。");
      } else setMessage("配置已保存至本机服务端。");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="模型与检索" onClose={onClose}>
      <div className="model-brand">
        <div>
          <strong>DeepSeek V4.1 Flash</strong>
          <p>文字理解、学习辅导与文档视觉识别</p>
        </div>
        <span
          className={`connection-badge ${config.configured ? "connected" : ""}`}
        >
          {config.configured ? "已配置" : "待连接"}
        </span>
      </div>
      <div className="form-grid">
        <label>
          接口地址
          <input
            value={config.baseUrl}
            onChange={(e) => setConfig({ ...config, baseUrl: e.target.value })}
            placeholder="https://api.deepseek.com"
          />
        </label>
        <label>
          模型 ID
          <input
            value={config.model}
            onChange={(e) => setConfig({ ...config, model: e.target.value })}
          />
        </label>
      </div>
      <label>
        API Key
        <div className="input-with-icon">
          <KeyRound size={15} />
          <input
            aria-label="模型 API Key"
            type={visible ? "text" : "password"}
            value={key}
            autoComplete="off"
            placeholder={
              config.configured
                ? "已保存 · 留空保持不变"
                : "输入你的 DeepSeek API Key"
            }
            onChange={(e) => setKey(e.target.value)}
          />
          <button
            className="icon-button"
            aria-label={visible ? "隐藏密钥" : "显示密钥"}
            onClick={() => setVisible(!visible)}
          >
            {visible ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </label>
      <p className="field-hint">
        密钥只保存在本机 .local/config.json，不写入浏览器或版本库。
      </p>
      <button
        className="advanced-toggle"
        onClick={() => setAdvanced(!advanced)}
      >
        {advanced ? "−" : "+"} 语义检索 · 可选 Embedding 服务
      </button>
      {advanced && (
        <div className="embedding-settings">
          <p>
            配置独立的 OpenAI 兼容 Embedding
            服务后启用混合检索。首次提问会批量建立向量，后续使用缓存。
          </p>
          <label>
            Embedding 接口地址
            <input
              placeholder="https://your-provider.com/v1"
              value={config.embeddingBaseUrl}
              onChange={(e) =>
                setConfig({ ...config, embeddingBaseUrl: e.target.value })
              }
            />
          </label>
          <label>
            Embedding 模型
            <input
              placeholder="服务商提供的模型 ID"
              value={config.embeddingModel}
              onChange={(e) =>
                setConfig({ ...config, embeddingModel: e.target.value })
              }
            />
          </label>
          <label>
            Embedding API Key
            <input
              type="password"
              autoComplete="off"
              placeholder={
                config.embeddingConfigured
                  ? "已保存 · 留空保持不变"
                  : "独立的 Embedding API Key"
              }
              value={embeddingKey}
              onChange={(e) => setEmbeddingKey(e.target.value)}
            />
          </label>
          <p className="field-hint">
            知识文本块和问题将发送至此服务用于计算向量。
          </p>
        </div>
      )}
      {message && (
        <div className="form-success">
          <CheckCircle2 size={16} />
          {message}
        </div>
      )}
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      <footer className="modal-actions">
        <button className="button" disabled={busy} onClick={() => void save()}>
          保存配置
        </button>
        <button
          className="button primary"
          disabled={busy || (!key && !config.configured)}
          onClick={() => void save(true)}
        >
          {busy ? <Loader2 size={15} className="spin" /> : <Link size={15} />}
          保存并测试连接
        </button>
      </footer>
    </Modal>
  );
}
