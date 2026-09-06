import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, createDb, DepsRepo, EventsRepo, TasksRepo, type Db } from "@superteam/data";
import type { Actor } from "@superteam/core";
import { TaskService } from "./task-service.js";

let db: Db;
let svc: TaskService;
const human: Actor = { actorType: "human", actorId: "lead" };

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "st-tasks-"));
  db = await createDb(join(dir, "t.db"));
  svc = new TaskService({
    tasks: new TasksRepo(db.db),
    deps: new DepsRepo(db.db),
    events: new EventsRepo(db.db),
  });
});

afterAll(async () => {
  await closeDb(db);
});

describe("TaskService", () => {
  it("create：DoD 必填，发布 task.created；assigneeMemberId 可显式传 null（负责人未定）", async () => {
    await expect(
      svc.create({ title: "x", dod: "" }, human),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });

    await expect(
      svc.create({ title: "x", dod: "d", assigneeMemberId: null }, human),
    ).resolves.toMatchObject({ status: "draft", assigneeMemberId: null });

    const t = await svc.create(
      { title: "实现批量取消", dod: "接口可用+幂等", module: "order", tags: ["java"] },
      human,
    );
    expect(t.status).toBe("draft");
    // 本用例已产生 2 条 task.created（null 负责人 1 条 + 正常 1 条）
    const evs = await new EventsRepo(db.db).listByType("task.created");
    expect(evs.length).toBe(2);
    expect(evs[0]?.payload).toMatchObject({ taskId: t.id });
  });

  it("transition：主路径持久化 + 事件含 from/to", async () => {
    const t = await svc.create({ title: "t2", dod: "d" }, human);
    const after = await svc.transition(t.id, "claim", human);
    expect(after.status).toBe("claimed");
    expect((await svc.get(t.id)).status).toBe("claimed");

    const evs = await new EventsRepo(db.db).listByType("task.transitioned");
    expect(evs[0]?.payload).toMatchObject({ from: "draft", to: "claimed", action: "claim" });
  });

  it("非法迁移：拒绝且不落库不发事件", async () => {
    const t = await svc.create({ title: "t3", dod: "d" }, human);
    await expect(svc.transition(t.id, "approve", human)).rejects.toMatchObject({
      code: "ILLEGAL_TRANSITION",
    });
    expect((await svc.get(t.id)).status).toBe("draft");
    const evs = await new EventsRepo(db.db).listByType("task.transitioned");
    const mine = evs.filter((e) => (e.payload as { taskId: string }).taskId === t.id);
    expect(mine.length).toBe(0);
  });

  it("setDeps：存在性校验、环检测、覆盖写、downstreamOf", async () => {
    const a = await svc.create({ title: "上游", dod: "d" }, human);
    const b = await svc.create({ title: "下游", dod: "d" }, human);
    const c = await svc.create({ title: "下游的下游", dod: "d" }, human);

    await svc.setDeps(b.id, [{ dependsOnTaskId: a.id, kind: "interface" }], human);
    await expect(
      svc.setDeps(b.id, [{ dependsOnTaskId: "task_nope" }], human),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    // 全局环检测：b→c 先建立成功，随后 c→b 必须被拒
    await svc.setDeps(b.id, [{ dependsOnTaskId: c.id }], human);
    await expect(
      svc.setDeps(c.id, [{ dependsOnTaskId: b.id }], human),
    ).rejects.toMatchObject({ code: "CYCLIC_DEPEND" });
    await expect(svc.setDeps(a.id, [{ dependsOnTaskId: a.id }], human)).rejects.toMatchObject({
      code: "CYCLIC_DEPEND",
    });

    // 覆盖写后 b 的依赖是 c；下游关系随之变化
    const deps = await svc.getDeps(b.id);
    expect(deps.length).toBe(1);
    expect(deps[0]?.dependsOnTaskId).toBe(c.id);

    const downstreamOfC = await svc.downstreamOf(c.id);
    expect(downstreamOfC.map((t) => t.id)).toContain(b.id);
    expect(await svc.downstreamOf(a.id)).toHaveLength(0);

    const evs = await new EventsRepo(db.db).listByType("task.dep_changed");
    expect(evs.length).toBeGreaterThanOrEqual(1);
  });
});
