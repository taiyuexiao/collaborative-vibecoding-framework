import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, createDb, type Db } from "./db.js";
import {
  ArtifactsRepo,
  DepsRepo,
  EventsRepo,
  MembersRepo,
  SessionsRepo,
  TasksRepo,
} from "./repos.js";
import { newId, type AgentSession, type Artifact, type Event, type Member, type Task } from "@superteam/core";

let db: Db;
let dir: string;
const now = new Date().toISOString();

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "st-data-"));
  db = await createDb(join(dir, "test.db"));
});

afterAll(async () => {
  await closeDb(db);
  rmSync(dir, { recursive: true, force: true });
});

const member: Member = {
  id: newId("mem"),
  name: "spl",
  role: "lead",
  tokenHash: "hash123",
  createdAt: now,
};

const task: Task = {
  id: newId("task"),
  title: "实现订单批量取消",
  description: "履约模块",
  dod: "1) 批量接口可用 2) 幂等 3) 单测覆盖",
  module: "order",
  tags: ["java", "order"],
  assigneeMemberId: null,
  assigneeSessionId: null,
  status: "draft",
  blockedFrom: null,
  conflictWith: [],
  createdAt: now,
  updatedAt: now,
};

const session: AgentSession = {
  id: newId("sess"),
  memberId: member.id,
  adapter: "claude-code",
  taskId: null,
  branch: null,
  status: "idle",
  diffSummary: null,
  lastHeartbeatAt: now,
};

const artifact: Artifact = {
  id: newId("af"),
  type: "card",
  path: "cards/2026-09-06-idempotent.md",
  title: "支付回调幂等坑",
  tags: ["java", "idempotency"],
  owner: "spl",
  status: "accepted",
  expiresAt: null,
  createdAt: now,
  updatedAt: now,
};

const event: Event = {
  id: newId("ev"),
  type: "task.created",
  payload: { taskId: task.id, title: task.title },
  actorType: "human",
  actorId: member.id,
  createdAt: now,
  consumedAt: null,
};

describe("数据层", () => {
  it("迁移幂等：重复 createDb 不炸", async () => {
    const again = await createDb(join(dir, "test.db"));
    await closeDb(again);
  });

  it("成员 CRUD", async () => {
    const repo = new MembersRepo(db.db);
    await repo.insert(member);
    expect((await repo.get(member.id))?.name).toBe("spl");
    expect((await repo.getByName("spl"))?.id).toBe(member.id);
    expect((await repo.getByName("nobody"))).toBeNull();
    expect((await repo.list()).length).toBe(1);
  });

  it("任务 CRUD 与 JSON 数组字段编解码", async () => {
    const repo = new TasksRepo(db.db);
    await repo.insert(task);
    const got = await repo.get(task.id);
    expect(got?.tags).toEqual(["java", "order"]);
    expect(got?.status).toBe("draft");

    await repo.update({ ...task, status: "coding", conflictWith: [newId("task")] });
    const updated = await repo.get(task.id);
    expect(updated?.status).toBe("coding");
    expect(updated?.conflictWith).toHaveLength(1);

    await repo.insert({ ...task, id: newId("task"), status: "done" });
    expect((await repo.list({ status: "done" })).length).toBe(1);
    expect((await repo.list({ module: "order" })).length).toBe(2);
  });

  it("依赖边 add/forTask/all/remove", async () => {
    const deps = new DepsRepo(db.db);
    const tasksRepo = new TasksRepo(db.db);
    const upstreamId = newId("task");
    await tasksRepo.insert({ ...task, id: upstreamId, status: "done" }); // FK：依赖边要求两端任务存在
    const d = { taskId: task.id, dependsOnTaskId: upstreamId, kind: "interface" as const };
    await deps.add(d);
    await deps.add(d); // 幂等
    expect((await deps.forTask(task.id)).length).toBe(1);
    expect((await deps.forTask(task.id))[0]?.kind).toBe("interface");
    await deps.remove(task.id, upstreamId);
    expect((await deps.forTask(task.id)).length).toBe(0);
  });

  it("会话 upsert/heartbeat/list", async () => {
    const repo = new SessionsRepo(db.db);
    await repo.upsert(session);
    await repo.upsert({
      ...session,
      taskId: task.id,
      branch: "task/x",
      status: "coding",
      diffSummary: "3 files changed",
      lastHeartbeatAt: new Date().toISOString(),
    });
    const got = await repo.get(session.id);
    expect(got?.status).toBe("coding");
    expect(got?.diffSummary).toBe("3 files changed");
    expect((await repo.list()).length).toBe(1);
  });

  it("档案 upsert（按 path 冲突）/getByPath/list", async () => {
    const repo = new ArtifactsRepo(db.db);
    await repo.upsert(artifact);
    await repo.upsert({ ...artifact, title: "支付回调幂等坑（更新）", tags: ["java"] });
    const byPath = await repo.getByPath(artifact.path);
    expect(byPath?.title).toBe("支付回调幂等坑（更新）");
    expect(byPath?.tags).toEqual(["java"]);
    expect((await repo.list({ type: "card" })).length).toBe(1);
    expect((await repo.list({ type: "spec" })).length).toBe(0);
  });

  it("事件 outbox：append → pending → markConsumed", async () => {
    const repo = new EventsRepo(db.db);
    await repo.append(event);
    await repo.append({ ...event, id: newId("ev"), type: "task.transitioned", payload: { x: 1 } });

    let pending = await repo.pending();
    expect(pending.length).toBe(2);

    await repo.markConsumed(pending.map((e) => e.id), new Date().toISOString());
    pending = await repo.pending();
    expect(pending.length).toBe(0);

    const byType = await repo.listByType("task.created");
    expect(byType.length).toBe(1);
    expect(byType[0]?.payload).toMatchObject({ taskId: task.id });
  });
});
