import { useCallback, useEffect, useState } from "react";
import { allowedActions, TASK_STATUSES, type TaskAction } from "@superteam/core";
import { api, type Task } from "./api.js";

type ArtifactHit = { path: string; title: string; tags: string[]; snippet: string };
type ArtifactDoc = {
  html: string;
  toc: { level: number; text: string; slug: string }[];
  meta: { path: string; title: string; type: string; tags: string[]; owner: string | null; status: string; expiresAt: string | null };
};

function KnowledgeView() {
  const [text, setText] = useState("");
  const [type, setType] = useState("");
  const [hits, setHits] = useState<ArtifactHit[]>([]);
  const [doc, setDoc] = useState<ArtifactDoc | null>(null);
  const [digest, setDigest] = useState<string | null>(null);

  const search = useCallback(async () => {
    setHits(await api.searchArtifacts({ text: text || undefined, type: type || undefined }));
  }, [text, type]);

  useEffect(() => {
    void search();
  }, [search]);

  const open = async (path: string) => setDoc(await api.readArtifact(path));

  return (
    <div className="knowledge">
      <div className="kbar">
        <input
          placeholder="检索知识（中文短语 / 关键词）"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void search()}
        />
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">全部类型</option>
          <option value="spec">spec</option>
          <option value="adr">adr</option>
          <option value="card">card</option>
          <option value="reading">reading</option>
          <option value="agent-doc">agent-doc</option>
        </select>
        <button onClick={() => void search()}>搜索</button>
        <button
          onClick={async () => {
            const r = await api.digest(24);
            setDigest(r.markdown);
          }}
        >
          生成日报
        </button>
      </div>

      <div className="klayout">
        <div className="klist">
          {hits.map((h) => (
            <div key={h.path} className="hit" onClick={() => void open(h.path)}>
              <b>{h.title}</b>
              <span className="tag">{h.path.split("/")[0]}</span>
              <div className="muted" dangerouslySetInnerHTML={{ __html: h.snippet }} />
            </div>
          ))}
          {hits.length === 0 && <p className="muted">无结果（agent 或成员 propose 后出现）</p>}
        </div>

        {doc && (
          <div className="kdoc">
            <header>
              <h2>{doc.meta.title}</h2>
              <button onClick={() => setDoc(null)}>×</button>
            </header>
            <div className="meta">
              <span className="tag">{doc.meta.type}</span>
              {doc.meta.tags.map((t) => (
                <span key={t} className="tag">{t}</span>
              ))}
              <span className="muted">
                {doc.meta.owner ? `by ${doc.meta.owner} · ` : ""}
                {doc.meta.status}
                {doc.meta.expiresAt ? ` · 过期 ${doc.meta.expiresAt}` : ""}
              </span>
            </div>
            {doc.toc.length > 0 && (
              <nav className="toc">
                {doc.toc.map((t) => (
                  <div key={t.slug} style={{ paddingLeft: (t.level - 2) * 14 }}>
                    {t.text}
                  </div>
                ))}
              </nav>
            )}
            <article className="md" dangerouslySetInnerHTML={{ __html: doc.html }} />
          </div>
        )}

        {digest && (
          <div className="kdoc">
            <header>
              <h2>共工日报</h2>
              <button onClick={() => setDigest(null)}>×</button>
            </header>
            <pre className="digest">{digest}</pre>
          </div>
        )}
      </div>
    </div>
  );
}

const COLUMNS = ["draft", "claimed", "coding", "self_review", "waiting_review", "blocked", "done"] as const;

const ACTION_LABELS: Record<TaskAction, string> = {
  claim: "认领",
  start: "开始",
  selfReview: "自检",
  submit: "提交评审",
  requestChanges: "打回",
  approve: "验收",
  block: "阻塞",
  resume: "恢复",
  cancel: "取消",
};

function Board() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [sessions, setSessions] = useState<{ id: string; memberId: string; adapter: string; status: string; taskId: string | null; branch: string | null; diffSummary: string | null }[]>([]);
  const [selected, setSelected] = useState<Task | null>(null);
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const [dod, setDod] = useState("");
  const [module_, setModule] = useState("");

  const refresh = useCallback(async () => {
    try {
      setTasks(await api.listTasks());
      setSessions(await api.listSessions());
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
    // WS 断线自动重连（指数退避）：服务重启/网络抖动后页面无需手动刷新
    let ws: WebSocket | null = null;
    let closed = false;
    let retry = 1000;
    const connect = () => {
      if (closed) return;
      ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
      ws.onopen = () => {
        retry = 1000;
        void refresh();
      };
      ws.onmessage = () => void refresh();
      ws.onclose = () => {
        if (!closed) {
          setTimeout(connect, retry);
          retry = Math.min(retry * 2, 15000);
        }
      };
      ws.onerror = () => ws?.close();
    };
    connect();
    return () => {
      closed = true;
      ws?.close();
    };
  }, [refresh]);

  const create = async () => {
    if (!title.trim() || !dod.trim()) {
      setError("title 与 DoD 必填");
      return;
    }
    try {
      await api.createTask({ title, dod, module: module_ || undefined });
      setTitle("");
      setDod("");
      setModule("");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const act = async (id: string, action: TaskAction) => {
    try {
      await api.transition(id, action);
      await refresh();
      if (selected?.id === id) setSelected(await api.taskDetail(id));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const openDetail = async (t: Task) => setSelected(await api.taskDetail(t.id));

  const addDep = async (depTaskId: string) => {
    if (!selected || !depTaskId) return;
    try {
      await api.setDeps(selected.id, [...(selected.deps ?? []), { dependsOnTaskId: depTaskId }]);
      setSelected(await api.taskDetail(selected.id));
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="layout">
      <aside className="side">
        <h2>新建任务</h2>
        <input placeholder="标题 *" value={title} onChange={(e) => setTitle(e.target.value)} />
        <textarea placeholder="DoD 验收标准 *" value={dod} onChange={(e) => setDod(e.target.value)} />
        <input placeholder="模块（如 order）" value={module_} onChange={(e) => setModule(e.target.value)} />
        <button onClick={create}>创建</button>
        {error && <p className="err">{error}</p>}

        <h2>Agent 会话</h2>
        {sessions.length === 0 && <p className="muted">暂无（daemon 接入后显示）</p>}
        {sessions.map((s) => (
          <div key={s.id} className="session">
            <b>{s.memberId}</b> · {s.adapter}
            <span className={`pill pill-${s.status}`}>{s.status}</span>
            {s.branch && <div className="muted mono">{s.branch}</div>}
            {s.diffSummary && <div className="muted">{s.diffSummary}</div>}
          </div>
        ))}
      </aside>

      <main className="board">
        {COLUMNS.map((col) => (
          <section key={col} className="col">
            <h3>
              {TASK_STATUSES.includes(col as never) ? col : col} <span className="count">{tasks.filter((t) => t.status === col).length}</span>
            </h3>
            {tasks
              .filter((t) => t.status === col)
              .map((t) => (
                <article key={t.id} className={`card ${t.conflictWith.length ? "conflict" : ""}`} onClick={() => void openDetail(t)}>
                  <header>
                    <b>{t.title}</b>
                    {t.conflictWith.length > 0 && <span className="pill pill-conflict">冲突 {t.conflictWith.length}</span>}
                  </header>
                  <div className="meta">
                    {t.module && <span className="tag">{t.module}</span>}
                    {t.tags.map((tag) => (
                      <span key={tag} className="tag">{tag}</span>
                    ))}
                  </div>
                  {t.dod && <div className="dod">✓ {t.dod}</div>}
                  <footer className="actions" onClick={(e) => e.stopPropagation()}>
                    {allowedActions(t.status as never)
                      .filter((a) => a !== "cancel")
                      .map((a) => (
                        <button key={a} onClick={() => void act(t.id, a)}>
                          {ACTION_LABELS[a]}
                        </button>
                      ))}
                  </footer>
                </article>
              ))}
          </section>
        ))}
      </main>

      {selected && (
        <aside className="detail">
          <header>
            <h3>{selected.title}</h3>
            <button onClick={() => setSelected(null)}>×</button>
          </header>
          <p className="muted mono">{selected.id}</p>
          <p>{selected.description || "（无描述）"}</p>
          <div className="dod">DoD: {selected.dod}</div>
          <h4>依赖（上游）</h4>
          {(selected.deps ?? []).length === 0 && <p className="muted">无</p>}
          {(selected.deps ?? []).map((d) => (
            <div key={d.dependsOnTaskId} className="dep">
              <span className="mono">{d.dependsOnTaskId}</span>
              <span className="tag">{d.kind}</span>
            </div>
          ))}
          <select
            value=""
            onChange={(e) => void addDep(e.target.value)}
          >
            <option value="">+ 添加依赖…</option>
            {tasks
              .filter((t) => t.id !== selected.id && !(selected.deps ?? []).some((d) => d.dependsOnTaskId === t.id))
              .map((t) => (
                <option key={t.id} value={t.id}>{t.title}</option>
              ))}
          </select>
          {allowedActions(selected.status as never).map((a) => (
            <button key={a} onClick={() => void act(selected.id, a)}>
              {ACTION_LABELS[a]}
            </button>
          ))}
        </aside>
      )}
    </div>
  );
}

function Gate({ onReady }: { onReady: () => void }) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("member");
  const [busy, setBusy] = useState(false);

  const go = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const r = await api.bootstrapMember(name.trim(), role);
      localStorage.setItem("st_token", r.token);
      localStorage.setItem("st_me", JSON.stringify(r.member));
      onReady();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="gate">
      <h1>共工 · Superteam</h1>
      <p className="muted">注册你的成员身份（token 只显示一次，存入浏览器）</p>
      <input placeholder="名字" value={name} onChange={(e) => setName(e.target.value)} />
      <select value={role} onChange={(e) => setRole(e.target.value)}>
        <option value="member">成员</option>
        <option value="lead">队长</option>
      </select>
      <button disabled={busy} onClick={() => void go()}>注册进入</button>
    </div>
  );
}

export default function App() {
  const [ready, setReady] = useState(Boolean(localStorage.getItem("st_token")));
  const [tab, setTab] = useState<"board" | "knowledge">("board");
  if (!ready) return <Gate onReady={() => setReady(true)} />;
  return (
    <>
      <nav className="topnav">
        <b className="brand">共工</b>
        <button className={tab === "board" ? "on" : ""} onClick={() => setTab("board")}>任务看板</button>
        <button className={tab === "knowledge" ? "on" : ""} onClick={() => setTab("knowledge")}>知识库</button>
      </nav>
      {tab === "board" ? <Board /> : <KnowledgeView />}
    </>
  );
}
