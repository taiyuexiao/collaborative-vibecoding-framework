/**
 * 全功能 E2E 扫描：对真实 main.ts 实例（含定时循环）过一遍所有功能。
 * 自带独立实例（7302 + 临时目录），不污染 7300。
 * 运行：npx tsx scripts/e2e-full.ts
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const PORT = 7302;
const BASE = `http://127.0.0.1:${PORT}`;
const dir = mkdtempSync(join(tmpdir(), "st-e2e-full-"));

let pass = 0;
let fail = 0;
const failures: string[] = [];
function ok(cond: unknown, name: string): void {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    failures.push(name);
    console.log(`  ✗ ${name}`);
  }
}
async function req<T>(method: string, path: string, body?: unknown, token?: string): Promise<{ status: number; data: T }> {
  const r = await fetch(`${BASE}/api/v1${path}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, data: (await r.json()) as T };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitReady(): Promise<void> {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`${BASE}/api/v1/tasks`);
      if (r.ok) return;
    } catch { /* not ready */ }
    await sleep(500);
  }
  throw new Error("server 未在 20s 内就绪");
}

/* ================= 启动真实实例 ================= */
console.log("▶ 启动真实 server（main.ts，含蒸馏/雷达循环）");
const server = spawn("npx", ["tsx", "packages/server/src/main.ts"], {
  cwd: ROOT,
  env: {
    ...process.env,
    SUPERTEAM_PORT: String(PORT),
    SUPERTEAM_DATA_DIR: join(dir, "data"),
    SUPERTEAM_KNOWLEDGE_DIR: join(dir, "knowledge"),
    SUPERTEAM_RADAR_INTERVAL_MS: "2000",
    SUPERTEAM_REPO_DIR: join(dir, "repo"), // 与 daemon 的 worktreeRoot 对齐，服务端雷达才能扫到
  },
  stdio: "ignore",
  detached: true,
});
await waitReady();

try {
  /* ================= 1. 静态托管 ================= */
  console.log("▶ 1. 静态托管与 SPA 回退");
  const home = await fetch(`${BASE}/`);
  ok(home.status === 200 && (await home.text()).includes("<html"), "GET / 返回 SPA 首页");
  const spa = await fetch(`${BASE}/tasks/whatever-deep`);
  ok(spa.status === 200, "深层前端路由 SPA 回退 200");
  const apiAuth = await req("POST", "/tasks", { title: "x", dod: "y" }, "bad-token");
  ok(apiAuth.status === 401 && !JSON.stringify(apiAuth.data).includes("<html"), "/api 写操作错误 token → 401 JSON（不回退 SPA、不 500）");
  ok((await req<{ length?: number }>("GET", "/tasks", undefined, "wrong-token")).status === 200, "公开读接口无需认证（设计如此）");

  /* ================= 2. 成员与认证 ================= */
  console.log("▶ 2. 成员与认证");
  const lead = (await req<{ token: string }>("POST", "/members", { name: "e2e-lead", role: "lead" })).data;
  const dev1 = (await req<{ token: string }>("POST", "/members", { name: "e2e-dev1" })).data;
  const dev2 = (await req<{ token: string }>("POST", "/members", { name: "e2e-dev2" })).data;
  ok(Boolean(lead.token && dev1.token && dev2.token), "三个成员注册拿到 token");
  ok((await req("POST", "/members", { name: "e2e-lead" })).status === 409, "重复成员名 409");
  ok((await req("POST", "/tasks", { title: "x", dod: "y" })).status === 401, "未认证写操作 401");
  const T = lead.token;

  /* ================= 3. 任务全生命周期 ================= */
  console.log("▶ 3. 任务全生命周期（合法/非法/阻塞/取消）");
  const mk = (title: string, extra: object = {}) => req<{ id: string }>("POST", "/tasks", { title, dod: "dod", ...extra }, T);
  ok((await req("POST", "/tasks", { title: "no-dod" }, T)).status === 400, "缺 DoD 创建 400");
  ok((await req("POST", "/tasks", { title: "no-auth" })).status === 401, "未认证创建 401");

  const tFull = (await mk("生命周期完整任务")).data.id;
  const steps: [string, string, string][] = [
    ["claim", "claimed", "认领"],
    ["start", "coding", "开始"],
    ["selfReview", "self_review", "自检"],
    ["submit", "waiting_review", "提交评审"],
    ["requestChanges", "coding", "打回"],
    ["submit", "waiting_review", "再提交"],
    ["approve", "done", "验收"],
  ];
  let cur = "draft";
  let lifeOk = true;
  for (const [action, expectStatus, label] of steps) {
    const r = await req<{ status: string }>("POST", `/tasks/${tFull}/transition`, { action }, T);
    if (r.status !== 200 || r.data.status !== expectStatus) { lifeOk = false; console.log(`    ${label} 失败: ${r.status} ${JSON.stringify(r.data)}`); break; }
    cur = expectStatus;
  }
  ok(lifeOk && cur === "done", "完整生命周期 draft→…→done（含打回返工）");
  ok((await req("POST", `/tasks/${tFull}/transition`, { action: "claim" }, T)).status === 409, "终态再操作 409");

  const tBlock = (await mk("阻塞恢复任务")).data.id;
  await req("POST", `/tasks/${tBlock}/transition`, { action: "claim" }, T);
  await req("POST", `/tasks/${tBlock}/transition`, { action: "start" }, T);
  ok((await req("POST", `/tasks/${tBlock}/transition`, { action: "block" }, T)).data.status === "blocked", "coding → blocked");
  ok((await req("POST", `/tasks/${tBlock}/transition`, { action: "resume" }, T)).data.status === "coding", "blocked → resume 回 coding");
  await req("POST", `/tasks/${tBlock}/transition`, { action: "cancel" }, T);
  ok((await req<{ status: string }>("GET", `/tasks/${tBlock}`)).data.status === "canceled", "coding → cancel");

  const tIll = (await mk("非法迁移")).data.id;
  ok((await req("POST", `/tasks/${tIll}/transition`, { action: "approve" }, T)).status === 409, "draft→approve 非法迁移 409");

  /* ================= 4. 依赖图 ================= */
  console.log("▶ 4. 依赖图（设置/替换/环检测）");
  const dA = (await mk("依赖上游A")).data.id;
  const dB = (await mk("依赖下游B")).data.id;
  ok((await req("PUT", `/tasks/${dB}/deps`, { deps: [{ dependsOnTaskId: dA, kind: "interface" }] }, T)).status === 200, "设置依赖边");
  ok(((await req<{ deps: unknown[] }>("GET", `/tasks/${dB}`)).data.deps ?? []).length === 1, "GET 任务含依赖");
  await req("PUT", `/tasks/${dB}/deps`, { deps: [] }, T);
  ok(((await req<{ deps: unknown[] }>("GET", `/tasks/${dB}`)).data.deps ?? []).length === 0, "PUT 空数组清空依赖（替换语义）");
  await req("PUT", `/tasks/${dB}/deps`, { deps: [{ dependsOnTaskId: dA }] }, T);
  ok((await req("PUT", `/tasks/${dA}/deps`, { deps: [{ dependsOnTaskId: dB }] }, T)).status === 409, "反向成环 409");
  ok((await req("PUT", `/tasks/${dA}/deps`, { deps: [{ dependsOnTaskId: "task_none" }] }, T)).status === 404, "依赖不存在任务 404");

  /* ================= 5. 知识档案 ================= */
  console.log("▶ 5. 知识档案（propose/检索/读取/历史/截断）");
  const p1 = await req<{ path: string; sha: string }>("POST", "/artifacts/propose", {
    type: "card", title: "e2e 幂等卡", tags: ["e2e", "idempotency"], body: "回调必须做幂等处理，使用 idempotency-key。", owner: "e2e-lead",
  }, T);
  ok(p1.status === 200 && p1.data.sha?.length === 40, "propose 卡片返回 commit sha");
  const pBig = await req<{ path: string }>("POST", "/artifacts/propose", {
    type: "reading", title: "e2e 超长文", tags: ["e2e"], body: "长".repeat(20000),
  }, T);
  // 截断保护属于 MCP read 工具（第 10 节验证）；HTTP 渲染路由返回 html+toc+meta
  const bigRender = await req<{ html: string; meta: { title: string } }>("GET", `/artifacts/${pBig.data.path}`);
  ok(bigRender.status === 200 && bigRender.data.meta.title === "e2e 超长文", "超长文档 HTTP 渲染正常");
  await req("POST", "/artifacts/propose", { type: "spec", title: "e2e 模块", tags: ["e2e"], body: "v1 内容" }, T);
  const specPath = "specs/e2e-模块.md";
  const h1 = await req<{ length: number }>("GET", `/artifacts/${specPath}?history=1`);
  await req("POST", "/artifacts/propose", { type: "spec", title: "e2e 模块", tags: ["e2e"], body: "v2 内容" }, T);
  const h2 = await req<{ length: number }>("GET", `/artifacts/${specPath}?history=1`);
  ok(h2.data.length === h1.data.length + 1, "spec 同路径更新产生新提交（历史 +1）");
  const search = await req<{ path: string }[]>("GET", "/artifacts?text=" + encodeURIComponent("幂等处理") + "&type=card&tags=e2e,idempotency");
  ok(search.data.length === 1 && search.data[0]?.path === p1.data.path, "中文短语+类型+标签联合检索命中");
  ok((await req("GET", `/artifacts/cards/none-${Date.now()}.md`)).status === 404, "读取未知路径 404");

  /* ================= 6. 会话 ================= */
  console.log("▶ 6. Agent 会话（注册/心跳/列表）");
  const sess = (await req<{ id: string }>("POST", "/sessions/register", { adapter: "claude-code" }, dev1.token)).data;
  ok(Boolean(sess.id), "daemon 注册会话");
  const hb = await req<{ status: string }>("POST", `/sessions/${sess.id}/heartbeat`, { status: "coding", branch: "task/x", diffSummary: "2 files: a.ts, b.ts" }, dev1.token);
  ok(hb.data.status === "coding", "心跳更新状态");
  ok((await req("POST", "/sessions/sess_none/heartbeat", {}, dev1.token)).status === 404, "未知会话心跳 404");
  ok(((await req<{ id: string }[]>("GET", "/sessions")).data.some((s) => s.id === sess.id)), "会话列表可见");

  /* ================= 7. WS 广播 ================= */
  console.log("▶ 7. WebSocket 广播");
  const wsMsg = await new Promise<string>((resolveP, rejectP) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    const timer = setTimeout(() => { try { ws.close(); } catch { /* noop */ } rejectP(new Error("WS 5s 内未收到广播")); }, 5000);
    ws.onopen = () => {
      // 握手完成后才触发事件，服务端才会把该 socket 计入广播名单
      void req("POST", "/tasks", { title: "WS 触发任务", dod: "d" }, T);
    };
    ws.onmessage = (e) => { clearTimeout(timer); try { ws.close(); } catch { /* noop */ } resolveP(String(e.data)); };
    ws.onerror = () => { clearTimeout(timer); rejectP(new Error("WS 连接失败")); };
  });
  ok(JSON.parse(wsMsg).type === "task.created", "建任务触发 task.created 广播");

  /* ================= 8. daemon 真执行链 + 雷达 ================= */
  console.log("▶ 8. daemon 执行链（echo adapter）+ 雷达扫描");
  const { TaskExecutor } = await import("../packages/daemon/src/executor.js");
  const { EchoAdapter } = await import("../packages/daemon/src/adapters.js");
  const { DaemonClient } = await import("../packages/daemon/src/client.js");
  const repo = join(dir, "repo");
  const executor = () => new TaskExecutor({
    client: new DaemonClient(BASE, dev2.token),
    adapter: new EchoAdapter(),
    repoDir: repo,
    worktreeRoot: join(repo, ".superteam-worktrees"),
  });
  const r1 = await executor().tick();
  const r2 = await executor().tick();
  console.log(`    tick#1: ${JSON.stringify(r1)}`);
  console.log(`    tick#2: ${JSON.stringify(r2)}`);
  ok(r1.claimed && r1.outcome === "submitted" && Boolean(r1.taskId), "tick#1 认领最旧 draft 并执行提交");
  ok(r2.claimed && r2.outcome === "submitted" && Boolean(r2.taskId), "tick#2 认领次旧 draft 并执行提交");
  ok(existsSync(join(repo, ".superteam-worktrees", r1.taskId!, "echo-output.md")), "worktree 产出文件存在");
  const s1 = (await req<{ status: string }>("GET", `/tasks/${r1.taskId}`)).data.status;
  ok(s1 === "waiting_review", "daemon 任务状态 waiting_review");
  const dev2Sessions = (await req<{ diffSummary: string | null }[]>("GET", "/sessions")).data;
  ok(dev2Sessions.some((s) => s.diffSummary?.includes("echo-output.md")), "心跳上报 diff 摘要");

  // 服务端雷达循环（2s，SUPERTEAM_REPO_DIR 已对齐 worktreeRoot）自动发现两任务同名产出文件：
  let conflictDetected = false;
  for (let i = 0; i < 10; i++) {
    const ta = (await req<{ conflictWith: string[] }>("GET", `/tasks/${r1.taskId}`)).data.conflictWith ?? [];
    if (ta.includes(r2.taskId!)) { conflictDetected = true; break; }
    await sleep(1000);
  }
  ok(conflictDetected, "服务端雷达循环自动检出双任务文件重叠（echo-output.md 同名）");

  /* ================= 9. 蒸馏循环（服务端 5s） ================= */
  console.log("▶ 9. 蒸馏循环（任务 done → 经验卡）");
  await req("POST", `/tasks/${r1.taskId}/transition`, { action: "approve" }, T);
  let distilled = false;
  for (let i = 0; i < 12; i++) {
    const hits = await req<{ title: string }[]>("GET", "/artifacts?text=" + encodeURIComponent("模板占位") + "&type=card");
    if (hits.data.length > 0) { distilled = true; break; } // NullLlm 模板卡（未配 LLM 的降级路径）
    await sleep(1000);
  }
  ok(distilled, "验收后 ≤12s 蒸馏器自动起草经验卡（NullLlm 降级模板）并入库");

  /* ================= 10. MCP stdio 真协议 ================= */
  console.log("▶ 10. MCP server（stdio JSON-RPC 真握手）");
  const mcpOk = await new Promise<boolean>((resolveP) => {
    const mcp = spawn("npx", ["tsx", "packages/mcp/src/main.ts"], {
      cwd: ROOT,
      env: { ...process.env, SUPERTEAM_DATA_DIR: join(dir, "data"), SUPERTEAM_KNOWLEDGE_DIR: join(dir, "knowledge") },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let buf = "";
    let step = 0;
    const bigPath = pBig.data.path; // 20000 字文档，验证 MCP read 截断保护
    const finish = (v: boolean) => { mcp.kill(); resolveP(v); };
    mcp.stdout!.on("data", (d) => {
      buf += String(d);
      let idx: number;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        let msg: { id?: number; result?: { tools?: { name: string }[]; content?: { text?: string }[] } };
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id === 1) {
          step = 1;
          mcp.stdin!.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
          mcp.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) + "\n");
        } else if (msg.id === 2) {
          const names = (msg.result?.tools ?? []).map((t) => t.name).sort();
          if (JSON.stringify(names) !== JSON.stringify(["latest", "propose", "read", "search"])) return finish(false);
          step = 2;
          mcp.stdin!.write(JSON.stringify({
            jsonrpc: "2.0", id: 3, method: "tools/call",
            params: { name: "search", arguments: { text: "幂等", type: "card" } },
          }) + "\n");
        } else if (msg.id === 3) {
          const text = msg.result?.content?.[0]?.text ?? "";
          if (!(step === 2 && text.includes("幂等卡"))) return finish(false);
          step = 3;
          mcp.stdin!.write(JSON.stringify({
            jsonrpc: "2.0", id: 4, method: "tools/call",
            params: { name: "read", arguments: { path: bigPath } },
          }) + "\n");
        } else if (msg.id === 4) {
          const parsed = JSON.parse(msg.result?.content?.[0]?.text ?? "{}") as { truncated?: boolean };
          return finish(step === 3 && parsed.truncated === true);
        }
      }
    });
    mcp.stdin!.write(JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "e2e", version: "0" } },
    }) + "\n");
    setTimeout(() => finish(false), 25000);
  });
  ok(mcpOk, "MCP initialize → tools/list(4) → search 命中知识");

  /* ================= 11. 日报与通知 ================= */
  console.log("▶ 11. 日报与通知出口");
  const digest = await req<{ markdown: string }>("GET", "/digest?hours=24");
  ok(digest.data.markdown.includes("共工日报") && digest.data.markdown.includes("任务动态"), "日报聚合 markdown");
  ok((await req("POST", "/digest/send", {}, T)).status === 200, "digest/send 推送（NullChannel）200");
  ok((await req("POST", "/digest/send", {})).status === 401, "digest/send 未认证 401");

  /* ================= 12. 稳定性小轰炸 ================= */
  console.log("▶ 12. 稳定性小轰炸");
  const bombs = await Promise.all([
    ...Array.from({ length: 10 }, () => req("GET", "/tasks")),
    ...Array.from({ length: 5 }, (_, i) => req("POST", "/tasks", { title: `并发${i}`, dod: "d" }, T)),
    ...Array.from({ length: 5 }, () => req("GET", "/sessions")),
  ]);
  ok(bombs.every((b) => b.status === 200), "20 路并发读写全部 200");
  const malformed = await fetch(`${BASE}/api/v1/tasks`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${T}` }, body: "{broken json" });
  ok(malformed.status >= 400 && malformed.status < 500, "畸形 JSON 请求不炸服务（4xx）");
} catch (err) {
  fail++;
  failures.push(`未捕获异常: ${(err as Error).message}`);
  console.log(`  ✗ 未捕获异常: ${(err as Error).stack}`);
} finally {
  if (server.pid) try { process.kill(-server.pid); } catch { server.kill(); }
}

console.log(`\n========== E2E 结果：${pass} 通过 / ${fail} 失败 ==========`);
if (failures.length > 0) {
  console.log("失败项：");
  for (const f of failures) console.log(`  - ${f}`);
  rmSync(dir, { recursive: true, force: true });
  process.exit(1);
}
rmSync(dir, { recursive: true, force: true });
process.exit(0);
