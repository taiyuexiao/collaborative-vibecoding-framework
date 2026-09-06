import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "./app.js";
import { createContext, type Context } from "./context.js";
import { loadConfig } from "@superteam/infra";

let ctx: Context;
let app: Awaited<ReturnType<typeof buildServer>>;
let dir: string;
let token = "";

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "st-server-"));
  const config = loadConfig({
    SUPERTEAM_DATA_DIR: join(dir, "data"),
    SUPERTEAM_KNOWLEDGE_DIR: join(dir, "knowledge"),
  });
  ctx = await createContext(config);
  app = await buildServer(ctx);
}, 30000);

afterAll(async () => {
  await app.close();
  await ctx.db.client.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("REST API", () => {
  it("bootstrap：创建成员并返回一次性 token；重复名 409", async () => {
    const r = await app.inject({ method: "POST", url: "/api/v1/members", payload: { name: "spl", role: "lead" } });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.token).toBeTruthy();
    token = body.token;
    expect(body.member.tokenHash).toBeUndefined();

    const dup = await app.inject({ method: "POST", url: "/api/v1/members", payload: { name: "spl" } });
    expect(dup.statusCode).toBe(409);
  });

  it("写操作未认证 → 401", async () => {
    const r = await app.inject({ method: "POST", url: "/api/v1/tasks", payload: { title: "x", dod: "y" } });
    expect(r.statusCode).toBe(401);
    expect(r.json().error.code).toBe("UNAUTHORIZED");
  });

  it("任务：创建 → 迁移 → 非法迁移 409 → 看板列表", async () => {
    const auth = { authorization: `Bearer ${token}` };
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/tasks",
      headers: auth,
      payload: { title: "实现批量取消", dod: "幂等", module: "order", tags: ["java"] },
    });
    expect(created.statusCode).toBe(200);
    const task = created.json();
    expect(task.status).toBe("draft");

    const tr = await app.inject({
      method: "POST",
      url: `/api/v1/tasks/${task.id}/transition`,
      headers: auth,
      payload: { action: "claim" },
    });
    expect(tr.json().status).toBe("claimed");

    const bad = await app.inject({
      method: "POST",
      url: `/api/v1/tasks/${task.id}/transition`,
      headers: auth,
      payload: { action: "approve" },
    });
    expect(bad.statusCode).toBe(409);
    expect(bad.json().error.code).toBe("ILLEGAL_TRANSITION");

    const list = await app.inject({ url: "/api/v1/tasks?status=claimed&tag=java" });
    expect(list.json().length).toBe(1);
  });

  it("依赖环 → 409 CYCLIC_DEPEND", async () => {
    const auth = { authorization: `Bearer ${token}` };
    const a = (await app.inject({ method: "POST", url: "/api/v1/tasks", headers: auth, payload: { title: "A", dod: "d" } })).json();
    const b = (await app.inject({ method: "POST", url: "/api/v1/tasks", headers: auth, payload: { title: "B", dod: "d" } })).json();
    await app.inject({ method: "PUT", url: `/api/v1/tasks/${a.id}/deps`, headers: auth, payload: { deps: [{ dependsOnTaskId: b.id }] } });
    const cyclic = await app.inject({ method: "PUT", url: `/api/v1/tasks/${b.id}/deps`, headers: auth, payload: { deps: [{ dependsOnTaskId: a.id }] } });
    expect(cyclic.statusCode).toBe(409);
    expect(cyclic.json().error.code).toBe("CYCLIC_DEPEND");
  });

  it("知识：propose → 检索 → 渲染读取", async () => {
    const auth = { authorization: `Bearer ${token}` };
    const p = await app.inject({
      method: "POST",
      url: "/api/v1/artifacts/propose",
      headers: auth,
      payload: { type: "card", title: "Kiro 粒度坑", body: "spec 粒度要与任务匹配。", tags: ["sdd"] },
    });
    expect(p.statusCode).toBe(200);
    const { path } = p.json();

    const hits = await app.inject({ url: `/api/v1/artifacts?text=${encodeURIComponent("spec 粒度")}` });
    expect(hits.json().length).toBe(1);

    const doc = await app.inject({ url: `/api/v1/artifacts/${path}` });
    expect(doc.statusCode).toBe(200);
    expect(doc.json().meta.title).toBe("Kiro 粒度坑");
    expect(doc.json().html).toContain("粒度");
  });

  it("会话：注册 → 心跳 → 列表", async () => {
    const auth = { authorization: `Bearer ${token}` };
    const reg = await app.inject({
      method: "POST",
      url: "/api/v1/sessions/register",
      headers: auth,
      payload: { adapter: "claude-code" },
    });
    expect(reg.statusCode).toBe(200);
    const sess = reg.json();

    const hb = await app.inject({
      method: "POST",
      url: `/api/v1/sessions/${sess.id}/heartbeat`,
      headers: auth,
      payload: { status: "coding", branch: "task/x", diffSummary: "2 files" },
    });
    expect(hb.json().status).toBe("coding");

    const list = await app.inject({ url: "/api/v1/sessions" });
    expect(list.json().length).toBe(1);
  });

  it("未知错误 → 500 且不泄露内部信息", async () => {
    const r = await app.inject({ url: "/api/v1/tasks/task_missing" });
    expect(r.statusCode).toBe(404);
  });
});
