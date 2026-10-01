import {
  Check,
  ChevronDown,
  CircleAlert,
  Clipboard,
  Cloud,
  Code2,
  Download,
  ExternalLink,
  FileCode2,
  KeyRound,
  Link2,
  LoaderCircle,
  Menu,
  Pencil,
  Plus,
  Search,
  Server,
  ShieldCheck,
  TerminalSquare,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  type ApiMeta,
  type OperatingSystem,
  type ScriptInput,
  type ScriptRecord,
  type ScriptRuntime,
} from "./types";

const EMPTY_SCRIPT: ScriptInput = {
  title: "",
  description: "",
  os: "linux",
  runtime: "bash",
  sourceType: "editor",
  sourceUrl: null,
  content: "#!/usr/bin/env bash\nset -euo pipefail\n\n",
  tags: [],
};

const OS_LABELS: Record<OperatingSystem, string> = {
  linux: "Linux",
  windows: "Windows",
  cross: "跨平台",
};

const RUNTIME_LABELS: Record<ScriptRuntime, string> = {
  bash: "Bash",
  powershell: "PowerShell",
  cmd: "CMD",
  python: "Python",
  other: "其他",
};

type ModalState =
  | { type: "editor"; script?: ScriptRecord; draft?: ScriptInput }
  | { type: "import" }
  | { type: "token" }
  | null;

type Toast = { id: number; kind: "success" | "error"; message: string };

export function App() {
  const [scripts, setScripts] = useState<ScriptRecord[]>([]);
  const [meta, setMeta] = useState<ApiMeta>({ writeProtected: false, maxScriptBytes: 256 * 1024 });
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [os, setOs] = useState<OperatingSystem | "all">("all");
  const [runtime, setRuntime] = useState<ScriptRuntime | "all">("all");
  const [modal, setModal] = useState<ModalState>(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([
      apiRequest<{ scripts: ScriptRecord[] }>("/api/scripts"),
      apiRequest<ApiMeta>("/api/meta"),
    ])
      .then(([scriptsResponse, metaResponse]) => {
        if (!active) return;
        setScripts(scriptsResponse.scripts);
        setMeta(metaResponse);
      })
      .catch((error: unknown) => {
        if (active) setToast({ id: Date.now(), kind: "error", message: getErrorMessage(error) });
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const filteredScripts = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("zh-CN");
    return scripts.filter((script) => {
      const matchesQuery =
        !needle ||
        [script.title, script.description, script.runtime, script.os, ...script.tags]
          .join(" ")
          .toLocaleLowerCase("zh-CN")
          .includes(needle);
      return matchesQuery && (os === "all" || script.os === os) && (runtime === "all" || script.runtime === runtime);
    });
  }, [scripts, query, os, runtime]);

  const stats = useMemo(
    () => ({
      total: scripts.length,
      linux: scripts.filter((script) => script.os === "linux" || script.os === "cross").length,
      windows: scripts.filter((script) => script.os === "windows" || script.os === "cross").length,
    }),
    [scripts],
  );

  function showToast(kind: Toast["kind"], message: string) {
    setToast({ id: Date.now(), kind, message });
  }

  async function saveScript(input: ScriptInput, id?: string) {
    const result = await apiRequest<{ script: ScriptRecord }>(id ? `/api/scripts/${id}` : "/api/scripts", {
      method: id ? "PUT" : "POST",
      body: JSON.stringify(input),
      auth: true,
    });
    setScripts((current) => [result.script, ...current.filter((script) => script.id !== result.script.id)]);
    setModal(null);
    showToast("success", id ? "脚本已更新" : "脚本已保存");
  }

  async function deleteScript(script: ScriptRecord) {
    if (!window.confirm(`确定删除“${script.title}”吗？此操作不可撤销。`)) return;
    try {
      await apiRequest(`/api/scripts/${script.id}`, { method: "DELETE", auth: true });
      setScripts((current) => current.filter((item) => item.id !== script.id));
      showToast("success", "脚本已删除");
    } catch (error) {
      handleMutationError(error);
    }
  }

  async function importScript(url: string) {
    try {
      const result = await apiRequest<{ script: ScriptRecord }>("/api/import", {
        method: "POST",
        body: JSON.stringify({ url }),
        auth: true,
      });
      setScripts((current) => [result.script, ...current]);
      setModal(null);
      showToast("success", "外部脚本已收藏为本地快照");
    } catch (error) {
      handleMutationError(error);
      throw error;
    }
  }

  function handleMutationError(error: unknown) {
    const message = getErrorMessage(error);
    showToast("error", message);
    if (message.includes("令牌")) {
      const token = window.prompt("请输入部署时配置的 ADMIN_TOKEN，保存后请再次提交：");
      if (token?.trim()) {
        sessionStorage.setItem("script-hub-token", token.trim());
        showToast("success", "管理员令牌已保存，请再次提交");
      }
    }
  }

  async function handleUpload(file: File) {
    if (file.size > meta.maxScriptBytes) {
      showToast("error", `文件不能超过 ${Math.floor(meta.maxScriptBytes / 1024)} KiB`);
      return;
    }
    try {
      const content = await file.text();
      if (content.includes("\0")) throw new Error("仅支持 UTF-8 文本脚本");
      const detected = detectFromFilename(file.name);
      setModal({
        type: "editor",
        draft: {
          ...EMPTY_SCRIPT,
          ...detected,
          title: file.name.replace(/\.[^.]+$/, ""),
          description: `上传自 ${file.name}`,
          sourceType: "upload",
          content,
          tags: ["上传"],
        },
      });
    } catch (error) {
      showToast("error", getErrorMessage(error));
    } finally {
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Script Hub 首页">
          <span className="brand-mark"><TerminalSquare size={20} strokeWidth={2.2} /></span>
          <span>Script Hub</span>
          <span className="brand-version">v0.1</span>
        </a>
        <nav className={mobileNav ? "nav-links is-open" : "nav-links"} aria-label="主导航">
          <a href="#library" onClick={() => setMobileNav(false)}>脚本库</a>
          <a href="#deploy" onClick={() => setMobileNav(false)}>部署</a>
          <a href="https://github.com/snail468/script-hub" target="_blank" rel="noreferrer">
            GitHub <ExternalLink size={13} />
          </a>
        </nav>
        <div className="topbar-actions">
          <button className="icon-button token-button" type="button" onClick={() => setModal({ type: "token" })} aria-label="设置管理员令牌" title="设置管理员令牌">
            {meta.writeProtected ? <ShieldCheck size={18} /> : <KeyRound size={18} />}
          </button>
          <button className="menu-button" type="button" onClick={() => setMobileNav((open) => !open)} aria-label="打开菜单">
            {mobileNav ? <X size={21} /> : <Menu size={21} />}
          </button>
        </div>
      </header>

      <main id="top">
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-copy">
            <div className="eyebrow"><span className="status-dot" /> 自托管 · 双平台 · 数据归你</div>
            <h1 id="hero-title">把常用脚本，<br /><span>放在伸手可及的地方。</span></h1>
            <p>收藏外部脚本、在线编辑或直接上传。需要时，一键复制运行命令，Linux 与 Windows 都照顾到。</p>
            <div className="hero-actions">
              <button className="primary-button" type="button" onClick={() => setModal({ type: "editor" })}>
                <Plus size={18} /> 新建脚本
              </button>
              <button className="secondary-button" type="button" onClick={() => setModal({ type: "import" })}>
                <Link2 size={17} /> 收藏外部脚本
              </button>
            </div>
          </div>
          <div className="hero-terminal" aria-label="运行命令示例">
            <div className="terminal-bar">
              <div className="terminal-dots"><i /><i /><i /></div>
              <span>quick-run</span>
              <span className="terminal-state"><span /> ready</span>
            </div>
            <div className="terminal-body">
              <p className="terminal-comment"># 一条命令运行收藏的脚本</p>
              <p><span className="terminal-prompt">$</span> curl -fsSL script.example/api/<br className="terminal-break" />scripts/system-info/raw | bash</p>
              <div className="terminal-output">
                <span>HOST</span><b>production-01</b>
                <span>KERNEL</span><b>Linux 6.8.0</b>
                <span>STATUS</span><b className="success-text">✓ healthy</b>
              </div>
            </div>
          </div>
        </section>

        <section className="stats-strip" aria-label="脚本统计">
          <div><span>脚本总数</span><strong>{String(stats.total).padStart(2, "0")}</strong></div>
          <div><span>Linux 可用</span><strong>{String(stats.linux).padStart(2, "0")}</strong></div>
          <div><span>Windows 可用</span><strong>{String(stats.windows).padStart(2, "0")}</strong></div>
          <div className="stats-note"><ShieldCheck size={20} /><span>脚本正文保存在<br />你自己的数据库中</span></div>
        </section>

        <section className="library-section" id="library" aria-labelledby="library-title">
          <div className="section-heading">
            <div>
              <span className="section-kicker">LIBRARY</span>
              <h2 id="library-title">脚本库</h2>
              <p>搜索、筛选，然后复制命令。就这么简单。</p>
            </div>
            <div className="library-actions">
              <input
                ref={fileInput}
                type="file"
                hidden
                accept=".sh,.bash,.ps1,.cmd,.bat,.py,.txt"
                onChange={(event) => event.target.files?.[0] && void handleUpload(event.target.files[0])}
              />
              <button className="secondary-button compact" type="button" onClick={() => fileInput.current?.click()}>
                <Upload size={16} /> 上传文件
              </button>
              <button className="primary-button compact" type="button" onClick={() => setModal({ type: "editor" })}>
                <Plus size={17} /> 新建脚本
              </button>
            </div>
          </div>

          <div className="filter-bar">
            <label className="search-field">
              <Search size={18} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称、标签或运行环境…" />
              {query && <button type="button" onClick={() => setQuery("")} aria-label="清除搜索"><X size={15} /></button>}
            </label>
            <FilterSelect label="系统" value={os} onChange={(value) => setOs(value as OperatingSystem | "all")} options={[
              ["all", "全部系统"], ["linux", "Linux"], ["windows", "Windows"], ["cross", "跨平台"],
            ]} />
            <FilterSelect label="环境" value={runtime} onChange={(value) => setRuntime(value as ScriptRuntime | "all")} options={[
              ["all", "全部环境"], ["bash", "Bash"], ["powershell", "PowerShell"], ["cmd", "CMD"], ["python", "Python"], ["other", "其他"],
            ]} />
            <span className="result-count">{filteredScripts.length} 个结果</span>
          </div>

          {loading ? (
            <div className="loading-state"><LoaderCircle className="spin" size={24} /><span>正在读取脚本库…</span></div>
          ) : filteredScripts.length ? (
            <div className="script-grid">
              {filteredScripts.map((script) => (
                <ScriptCard
                  key={script.id}
                  script={script}
                  onEdit={() => setModal({ type: "editor", script })}
                  onDelete={() => void deleteScript(script)}
                  onToast={showToast}
                />
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <FileCode2 size={32} />
              <h3>没有找到脚本</h3>
              <p>换个关键词或清除筛选条件，也可以创建第一条脚本。</p>
              <button className="primary-button compact" type="button" onClick={() => { setQuery(""); setOs("all"); setRuntime("all"); }}>
                清除筛选
              </button>
            </div>
          )}
        </section>

        <section className="deploy-section" id="deploy" aria-labelledby="deploy-title">
          <div className="deploy-copy">
            <span className="section-kicker light">DEPLOY ANYWHERE</span>
            <h2 id="deploy-title">自己的脚本，<br />当然要跑在自己的地方。</h2>
            <p>同一套界面与接口，可使用 GitHub 预构建 Docker 镜像，也可部署到 Cloudflare Workers。</p>
          </div>
          <div className="deploy-options">
            <article>
              <span className="deploy-icon"><Server size={22} /></span>
              <div><h3>Docker</h3><p>SQLite 持久化，适合 NAS、VPS 与内网服务器。</p></div>
              <code>docker compose up -d</code>
            </article>
            <article>
              <span className="deploy-icon cloud"><Cloud size={22} /></span>
              <div><h3>Cloudflare Workers</h3><p>D1 数据库，全球边缘运行，无需维护服务器。</p></div>
              <code>pnpm run cf:deploy</code>
            </article>
          </div>
        </section>
      </main>

      <footer>
        <a className="brand footer-brand" href="#top"><span className="brand-mark"><TerminalSquare size={18} /></span>Script Hub</a>
        <p>为重复的工作，保留一条更短的路。</p>
        <span>MIT Licensed · Self-hosted</span>
      </footer>

      {modal?.type === "editor" && (
        <EditorModal
          script={modal.script}
          draft={modal.draft}
          maxBytes={meta.maxScriptBytes}
          onClose={() => setModal(null)}
          onSave={saveScript}
          onError={handleMutationError}
        />
      )}
      {modal?.type === "import" && <ImportModal onClose={() => setModal(null)} onImport={importScript} />}
      {modal?.type === "token" && (
        <TokenModal
          protectedMode={meta.writeProtected}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); showToast("success", "管理员令牌已保存在本次会话中"); }}
        />
      )}
      {toast && <div key={toast.id} className={`toast ${toast.kind}`} role="status">
        {toast.kind === "success" ? <Check size={17} /> : <CircleAlert size={17} />}{toast.message}
      </div>}
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: [string, string][] }) {
  return (
    <label className="select-field">
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}
      </select>
      <ChevronDown size={15} />
    </label>
  );
}

function ScriptCard({ script, onEdit, onDelete, onToast }: { script: ScriptRecord; onEdit: () => void; onDelete: () => void; onToast: (kind: Toast["kind"], message: string) => void }) {
  const [copied, setCopied] = useState(false);
  const command = makeCommand(script);

  async function copyCommand() {
    try {
      await copyText(command);
      setCopied(true);
      onToast("success", "运行命令已复制，请确认脚本内容后再执行");
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      onToast("error", "复制失败，请手动选择命令");
    }
  }

  return (
    <article className="script-card">
      <div className="card-topline">
        <div className="badges">
          <span className={`os-badge ${script.os}`}><span />{OS_LABELS[script.os]}</span>
          <span className="runtime-badge">{RUNTIME_LABELS[script.runtime]}</span>
        </div>
        <div className="card-menu">
          <button type="button" onClick={onEdit} aria-label={`编辑 ${script.title}`}><Pencil size={16} /></button>
          <button type="button" className="danger" onClick={onDelete} aria-label={`删除 ${script.title}`}><Trash2 size={16} /></button>
        </div>
      </div>
      <button className="card-title" type="button" onClick={onEdit}>
        <span><Code2 size={20} /></span>
        <span><strong>{script.title}</strong><small>{script.description || "暂无简介"}</small></span>
      </button>
      <pre className="code-preview"><code>{script.content.split("\n").slice(0, 5).join("\n")}</code></pre>
      <div className="tag-row">
        {script.tags.slice(0, 4).map((tag) => <span key={tag}>#{tag}</span>)}
        {script.sourceUrl && <a href={script.sourceUrl} target="_blank" rel="noreferrer">来源 <ExternalLink size={12} /></a>}
      </div>
      <div className="command-box">
        <span className="command-prompt">›</span>
        <code title={command}>{command}</code>
        <button type="button" onClick={() => void copyCommand()} className={copied ? "copied" : ""} aria-label="复制运行命令">
          {copied ? <Check size={16} /> : <Clipboard size={16} />}
        </button>
      </div>
      <div className="card-footer">
        <span>更新于 {formatDate(script.updatedAt)}</span>
        <a href={`/api/scripts/${script.id}/raw?download=1`} download><Download size={14} /> 下载</a>
      </div>
    </article>
  );
}

function EditorModal({ script, draft, maxBytes, onClose, onSave, onError }: {
  script?: ScriptRecord;
  draft?: ScriptInput;
  maxBytes: number;
  onClose: () => void;
  onSave: (input: ScriptInput, id?: string) => Promise<void>;
  onError: (error: unknown) => void;
}) {
  const initial = draft ?? script ?? EMPTY_SCRIPT;
  const [form, setForm] = useState<ScriptInput>({
    title: initial.title,
    description: initial.description,
    os: initial.os,
    runtime: initial.runtime,
    sourceType: initial.sourceType,
    sourceUrl: initial.sourceUrl,
    content: initial.content,
    tags: [...initial.tags],
  });
  const [tags, setTags] = useState(initial.tags.join(", "));
  const [saving, setSaving] = useState(false);
  const bytes = new TextEncoder().encode(form.content).byteLength;
  useEscape(onClose);

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      setSaving(true);
      await onSave({ ...form, tags: tags.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean) }, script?.id);
    } catch (error) {
      onError(error);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={script ? "编辑脚本" : draft ? "确认上传内容" : "新建脚本"} subtitle="内容会直接保存在你自己的数据库中" onClose={onClose} wide>
      <form className="editor-form" onSubmit={(event) => void submit(event)}>
        <div className="form-grid two-columns">
          <label><span>脚本名称</span><input required maxLength={80} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="例如：服务健康检查" /></label>
          <label><span>标签 <small>使用逗号分隔</small></span><input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="运维, Docker, 日常" /></label>
        </div>
        <label><span>简介</span><input maxLength={240} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="一句话说明脚本的用途和注意事项" /></label>
        <div className="form-grid two-columns">
          <label><span>适用系统</span><div className="select-control"><select value={form.os} onChange={(event) => setForm({ ...form, os: event.target.value as OperatingSystem })}><option value="linux">Linux</option><option value="windows">Windows</option><option value="cross">跨平台</option></select><ChevronDown size={15} /></div></label>
          <label><span>运行环境</span><div className="select-control"><select value={form.runtime} onChange={(event) => setForm({ ...form, runtime: event.target.value as ScriptRuntime })}><option value="bash">Bash</option><option value="powershell">PowerShell</option><option value="cmd">CMD</option><option value="python">Python</option><option value="other">其他</option></select><ChevronDown size={15} /></div></label>
        </div>
        <label className="code-field">
          <span>脚本内容 <small className={bytes > maxBytes ? "over-limit" : ""}>{formatBytes(bytes)} / {formatBytes(maxBytes)}</small></span>
          <div className="editor-shell"><div className="editor-gutter">01<br />02<br />03<br />04<br />05<br />06<br />07<br />08</div><textarea required spellCheck={false} value={form.content} onChange={(event) => setForm({ ...form, content: event.target.value })} /></div>
        </label>
        <div className="modal-actions">
          <span className="safety-note"><ShieldCheck size={15} />运行前请先检查脚本内容</span>
          <button className="secondary-button compact" type="button" onClick={onClose}>取消</button>
          <button className="primary-button compact" disabled={saving || bytes > maxBytes} type="submit">{saving ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}{script ? "保存修改" : "保存脚本"}</button>
        </div>
      </form>
    </Modal>
  );
}

function ImportModal({ onClose, onImport }: { onClose: () => void; onImport: (url: string) => Promise<void> }) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  useEscape(onClose);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    try { await onImport(url); } finally { setLoading(false); }
  }
  return (
    <Modal title="收藏外部脚本" subtitle="抓取脚本并保存快照，源站变更不会影响已收藏内容" onClose={onClose}>
      <form className="import-form" onSubmit={(event) => void submit(event)}>
        <label><span>HTTPS 脚本地址</span><div className="url-input"><Link2 size={18} /><input type="url" required autoFocus value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://github.com/user/repo/blob/main/install.sh" /></div></label>
        <div className="info-panel"><ShieldCheck size={18} /><p>默认允许 GitHub Raw、Gist、GitLab 和 Bitbucket。服务端会限制重定向、响应时间与文件大小。</p></div>
        <div className="modal-actions"><span /><button className="secondary-button compact" type="button" onClick={onClose}>取消</button><button className="primary-button compact" disabled={loading} type="submit">{loading ? <LoaderCircle className="spin" size={16} /> : <Download size={16} />}抓取并收藏</button></div>
      </form>
    </Modal>
  );
}

function TokenModal({ protectedMode, onClose, onSaved }: { protectedMode: boolean; onClose: () => void; onSaved: () => void }) {
  const [token, setToken] = useState(() => sessionStorage.getItem("script-hub-token") ?? "");
  useEscape(onClose);
  function save(event: FormEvent) {
    event.preventDefault();
    if (token.trim()) sessionStorage.setItem("script-hub-token", token.trim());
    else sessionStorage.removeItem("script-hub-token");
    onSaved();
  }
  return (
    <Modal title="管理员令牌" subtitle={protectedMode ? "服务器已开启写保护" : "服务器未配置令牌，当前允许匿名写入"} onClose={onClose}>
      <form className="import-form" onSubmit={save}>
        <label><span>ADMIN_TOKEN</span><div className="url-input"><KeyRound size={18} /><input type="password" autoFocus value={token} onChange={(event) => setToken(event.target.value)} placeholder="输入部署时设置的令牌" /></div></label>
        <div className="info-panel"><ShieldCheck size={18} /><p>令牌只保存在当前浏览器会话中，关闭标签页后会清除，不会写入数据库。</p></div>
        <div className="modal-actions"><span /><button className="secondary-button compact" type="button" onClick={() => { sessionStorage.removeItem("script-hub-token"); setToken(""); }}>清除</button><button className="primary-button compact" type="submit"><Check size={16} />保存</button></div>
      </form>
    </Modal>
  );
}

function Modal({ title, subtitle, onClose, wide = false, children }: { title: string; subtitle: string; onClose: () => void; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className={wide ? "modal wide" : "modal"} role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <header><div><h2 id="modal-title">{title}</h2><p>{subtitle}</p></div><button className="icon-button" type="button" onClick={onClose} aria-label="关闭"><X size={20} /></button></header>
        {children}
      </section>
    </div>
  );
}

function useEscape(onClose: () => void) {
  useEffect(() => {
    const handle = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [onClose]);
}

function makeCommand(script: ScriptRecord): string {
  const rawUrl = `${window.location.origin}/api/scripts/${encodeURIComponent(script.id)}/raw`;
  if (script.runtime === "powershell") return `irm '${rawUrl}' | iex`;
  if (script.runtime === "cmd") return `curl.exe -fsSL "${rawUrl}" -o "%TEMP%\\script.cmd" && call "%TEMP%\\script.cmd"`;
  if (script.runtime === "python") return `curl -fsSL '${rawUrl}' | python3`;
  if (script.runtime === "bash") return `curl -fsSL '${rawUrl}' | bash`;
  return `curl -fsSLO '${rawUrl}?download=1'`;
}

async function apiRequest<T = unknown>(path: string, options: RequestInit & { auth?: boolean } = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body) headers.set("Content-Type", "application/json");
  if (options.auth) {
    const token = sessionStorage.getItem("script-hub-token");
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }
  const response = await fetch(path, { ...options, headers });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: `请求失败 (${response.status})` })) as { error?: string };
    throw new Error(body.error || `请求失败 (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value);
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("copy failed");
}

function detectFromFilename(filename: string): Pick<ScriptInput, "os" | "runtime"> {
  const extension = filename.split(".").at(-1)?.toLowerCase();
  if (extension === "ps1") return { os: "windows", runtime: "powershell" };
  if (extension === "cmd" || extension === "bat") return { os: "windows", runtime: "cmd" };
  if (extension === "py") return { os: "cross", runtime: "python" };
  if (extension === "sh" || extension === "bash") return { os: "linux", runtime: "bash" };
  return { os: "cross", runtime: "other" };
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "未知" : new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(date);
}

function formatBytes(value: number) {
  return value < 1024 ? `${value} B` : `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KiB`;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请稍后重试";
}
