import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "@superteam/server";
import { createContext, type Context } from "@superteam/server";
import { loadConfig } from "@superteam/infra";
import { LocalGitProvider } from "@superteam/gitprov";
import { EchoAdapter } from "./adapters.js";
import { buildPrompt } from "./client.js";
import { TaskExecutor } from "./executor.js";
import type { Task } from "@superteam/core";

let ctx: Context;
let app: Awaited<ReturnType<typeof buildServer>>;
let dir: string;
let url = "";
let token = "";

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "st-daemon-"));
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

  const reg = await app.inject({ method: "POST", url: "/api/v1/members", payload: { name: "worker" } });
  token = reg.json().token;

  // 任务源仓库：main + 一个初始提交
  const repo = join(dir, "repo");
  const git = new LocalGitProvider();
  await git.ensureRepo(repo);
  await git.commitAll(repo, "init");
}, 30000);

afterAll(async () => {
  await app.close();
  await ctx.db.client.close();
  rmSync(dir, { recursive: true, force: true });
});

async function createTask(title: string): Promise<Task> {
  const r = await app.inject({
    method: "POST",
    url: "/api/v1/tasks",
    headers: { authorization: `Bearer ${token}` },
    payload: { title, dod: "echo 产出存在", module: "order" },
  });
  return r.json();
}

describe("daemon 全链路（echo adapter）", () => {
  it("buildPrompt 含任务三要素与 AGENTS.md", () => {
    const p = buildPrompt(
      { id: "t1", title: "实现X", description: "描述", dod: "DoD内容", module: "m", tags: [], assigneeMemberId: null, assigneeSessionId: null, status: "draft", blockedFrom: null, conflictWith: [], createdAt: "", updatedAt: "" },
      "# 团队规范\n用中文注释",
    );
    expect(p).toContain("实现X");
    expect(p).toContain("DoD内容");
    expect(p).toContain("用中文注释");
  });

  it("tick：认领 → worktree 提交 → waiting_review → 会话状态同步", async () => {
    const task = await createTask("echo 全链路任务");
    const repo = join(dir, "repo");
    const executor = new TaskExecutor({
      client: new (await import("./client.js")).DaemonClient(url, token),
      adapter: new EchoAdapter(),
      repoDir: repo,
      worktreeRoot: join(dir, "wts"),
      logger: undefined,
    });

    const r = await executor.tick();
    expect(r).toMatchObject({ claimed: true, taskId: task.id, outcome: "submitted" });

    // 服务端状态：任务到 waiting_review
    const detail = await app.inject({ url: `/api/v1/tasks/${task.id}` });
    expect(detail.json().status).toBe("waiting_review");

    // 分支有提交、产出文件存在
    const git = new LocalGitProvider();
    const sha = await git.revParse(repo, `refs/heads/task/${task.id}`);
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    expect(existsSync(join(dir, "wts", task.id, "echo-output.md"))).toBe(true);

    // 会话心跳已同步 diffSummary
    const sessions = await app.inject({ url: "/api/v1/sessions" });
    expect(sessions.json().length).toBeGreaterThan(0);
  }, 30000);

  it("无任务时 tick 空转", async () => {
    const executor = new TaskExecutor({
      client: new (await import("./client.js")).DaemonClient(url, token),
      adapter: new EchoAdapter(),
      repoDir: join(dir, "repo"),
      worktreeRoot: join(dir, "wts"),
    });
    expect(await executor.tick()).toEqual({ claimed: false });
  });

  it("adapter 失败 → 任务 blocked + 会话上报错误", async () => {
    const task = await createTask("注定失败的任务");
    const executor = new TaskExecutor({
      client: new (await import("./client.js")).DaemonClient(url, token),
      adapter: {
        name: "boom",
        available: async () => true,
        run: async () => ({ exitCode: 1, output: "爆炸" }),
      },
      repoDir: join(dir, "repo"),
      worktreeRoot: join(dir, "wts"),
    });
    const r = await executor.tick();
    expect(r.outcome).toBe("blocked");
    const detail = await app.inject({ url: `/api/v1/tasks/${task.id}` });
    expect(detail.json().status).toBe("blocked");
  }, 30000);
});
