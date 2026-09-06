import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "./app.js";
import { createContext, type Context } from "./context.js";
import { loadConfig } from "@superteam/infra";
import { LocalGitProvider } from "@superteam/gitprov";
import { ConflictRadar } from "@superteam/radar";
import { EventConsumer, taskDoneCardRule, NullLlm } from "@superteam/distiller";
import { DaemonClient, TaskExecutor } from "@superteam/daemon";
import { EchoAdapter } from "@superteam/daemon";

let ctx: Context;
let app: Awaited<ReturnType<typeof buildServer>>;
let dir: string;
let url = "";
let token = "";

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "st-e2e-"));
  ctx = await createContext(
    loadConfig({
      SUPERTEAM_DATA_DIR: join(dir, "data"),
      SUPERTEAM_KNOWLEDGE_DIR: join(dir, "knowledge"),
      SUPERTEAM_PORT: "0",
    }),
  );
  app = await buildServer(ctx);
  await app.listen({ port: 0, host: "127.0.0.1" });
  url = `http://127.0.0.1:${(app.server?.address() as { port: number }).port}`;
  const reg = await app.inject({ method: "POST", url: "/api/v1/members", payload: { name: "lead", role: "lead" } });
  token = reg.json().token;
}, 30000);

afterAll(async () => {
  await app.close();
  await ctx.db.client.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("端到端冒烟：建任务 → daemon 执行 → 冲突 → 验收 → 蒸馏 → 日报", () => {
  let taskA = "";
  let taskB = "";

  it("① 队长建两个任务", async () => {
    const auth = { authorization: `Bearer ${token}` };
    const a = await app.inject({ method: "POST", url: "/api/v1/tasks", headers: auth, payload: { title: "订单批量取消", dod: "幂等可用", module: "order" } });
    const b = await app.inject({ method: "POST", url: "/api/v1/tasks", headers: auth, payload: { title: "退款对账", dod: "对平", module: "order" } });
    taskA = a.json().id;
    taskB = b.json().id;
    expect(taskA).toBeTruthy();
    expect(taskB).toBeTruthy();
  });

  it("② daemon（echo adapter）执行任务 A 与 B，各自分支提交", async () => {
    const repo = join(dir, "repo");
    await new LocalGitProvider().ensureRepo(repo);
    const executor = () =>
      new TaskExecutor({
        client: new DaemonClient(url, token),
        adapter: new EchoAdapter(),
        repoDir: repo,
        worktreeRoot: join(repo, ".superteam-worktrees"),
      });
    expect((await executor().tick()).outcome).toBe("submitted");
    expect((await executor().tick()).outcome).toBe("submitted");
    expect((await app.inject({ url: `/api/v1/tasks/${taskA}` })).json().status).toBe("waiting_review");
  });

  it("③ 雷达扫描：两任务在途产物重叠 → 双向 conflictWith", async () => {
    const repo = join(dir, "repo");
    const radar = new ConflictRadar({ git: new LocalGitProvider(), tasks: ctx.tasks, deps: ctx.deps, events: ctx.events });
    const report = await radar.sweep([
      { taskId: taskA, dir: join(repo, ".superteam-worktrees", taskA) },
      { taskId: taskB, dir: join(repo, ".superteam-worktrees", taskB) },
    ]);
    expect(report.fileConflicts.length).toBe(1); // echo-output.md 同名
    expect((await app.inject({ url: `/api/v1/tasks/${taskA}` })).json().conflictWith).toContain(taskB);
  });

  it("④ 队长验收任务 A → done；⑤ 蒸馏器把任务沉淀为经验卡", async () => {
    const auth = { authorization: `Bearer ${token}` };
    await app.inject({ method: "POST", url: `/api/v1/tasks/${taskA}/transition`, headers: auth, payload: { action: "approve" } });

    const consumer = new EventConsumer(ctx.events);
    const n = await consumer.consumeOnce([taskDoneCardRule({ knowledge: ctx.knowledge, llm: new NullLlm() })]);
    expect(n).toBeGreaterThan(0);

    const hits = await ctx.search.query({ text: "批量取消", type: "card" });
    expect(hits.length).toBe(1);
    expect(hits[0]?.title).toContain("订单批量取消");
  });

  it("⑥ 日报聚合任务动态/冲突/新知识", async () => {
    const md = await ctx.digest.generate(24);
    expect(md).toContain("订单批量取消");
    expect(md).toContain("冲突预警");
    expect(md).toContain("新沉淀知识");
  });
});
