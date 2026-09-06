import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, createDb, DepsRepo, EventsRepo, TasksRepo, type Db } from "@superteam/data";
import { LocalGitProvider } from "@superteam/gitprov";
import { ConflictRadar } from "./radar.js";

let dir: string;
let db: Db;
let git: LocalGitProvider;
let repo: string;
let radar: ConflictRadar;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "st-radar-"));
  db = await createDb(join(dir, "t.db"));
  git = new LocalGitProvider();
  repo = join(dir, "repo");
  await git.ensureRepo(repo);
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, "src", "base.ts"), "export {};\n");
  await git.commitAll(repo, "init");

  radar = new ConflictRadar({
    git,
    tasks: new TasksRepo(db.db),
    deps: new DepsRepo(db.db),
    events: new EventsRepo(db.db),
  });
});

afterAll(async () => {
  await closeDb(db);
  rmSync(dir, { recursive: true, force: true });
});

async function seedTask(title: string, status: "coding" | "waiting_review" = "coding") {
  const id = `task_${title}${Math.random().toString(36).slice(2, 6)}`;
  const now = new Date().toISOString();
  await new TasksRepo(db.db).insert({
    id,
    title,
    description: "",
    dod: "d",
    module: null,
    tags: [],
    assigneeMemberId: null,
    assigneeSessionId: null,
    status,
    blockedFrom: null,
    conflictWith: [],
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function makeWorktree(taskId: string, editFile: string, content: string): Promise<string> {
  const wt = join(dir, "wts", taskId);
  await git.ensureWorktree(repo, wt, `task/${taskId}`);
  mkdirSync(join(wt, editFile, ".."), { recursive: true });
  writeFileSync(join(wt, editFile), content);
  await git.commitAll(wt, `task work ${taskId}`);
  return wt;
}

describe("ConflictRadar", () => {
  it("双 worktree 改同一文件 → 文件重叠告警 + conflictWith 双向 + 事件", async () => {
    const a = await seedTask("A");
    const b = await seedTask("B");
    const wtA = await makeWorktree(a, "src/shared.ts", "export const a = 1;\n");
    const wtB = await makeWorktree(b, "src/shared.ts", "export const b = 2;\n");

    const report = await radar.sweep([
      { taskId: a, dir: wtA },
      { taskId: b, dir: wtB },
    ]);
    expect(report.fileConflicts).toHaveLength(1);
    expect(report.fileConflicts[0]?.files).toEqual(["src/shared.ts"]);

    const tasksRepo = new TasksRepo(db.db);
    expect((await tasksRepo.get(a))?.conflictWith).toContain(b);
    expect((await tasksRepo.get(b))?.conflictWith).toContain(a);

    const events = await new EventsRepo(db.db).listByType("task.conflict_alert");
    expect(events.length).toBe(1);
    expect(events[0]?.payload).toMatchObject({ kind: "files", a, b });
  });

  it("契约文件变更 → 下游任务收 contract 告警", async () => {
    const up = await seedTask("上游契约改动");
    const down = await seedTask("下游实现");
    await new DepsRepo(db.db).add({ taskId: down, dependsOnTaskId: up, kind: "interface" });
    const wt = await makeWorktree(up, "specs/order.md", "# 订单模块 v2\n");

    const report = await radar.sweep([{ taskId: up, dir: wt }]);
    expect(report.contractAlerts).toHaveLength(1);
    expect(report.contractAlerts[0]?.downstream).toEqual([down]);

    const tasksRepo = new TasksRepo(db.db);
    expect((await tasksRepo.get(down))?.conflictWith).toContain(up);
  });

  it("无重叠 → 空 report、不发事件", async () => {
    const before = (await new EventsRepo(db.db).listByType("task.conflict_alert")).length;
    const c = await seedTask("C");
    const d = await seedTask("D");
    const wtC = await makeWorktree(c, "src/c.ts", "export const c = 3;\n");
    const wtD = await makeWorktree(d, "src/d.ts", "export const d = 4;\n");
    const report = await radar.sweep([
      { taskId: c, dir: wtC },
      { taskId: d, dir: wtD },
    ]);
    expect(report.fileConflicts).toHaveLength(0);
    expect(report.contractAlerts).toHaveLength(0);
    expect((await new EventsRepo(db.db).listByType("task.conflict_alert")).length).toBe(before);
  });

  it("重复 sweep 幂等：第二次不重发事件", async () => {
    const e = await seedTask("E");
    const f = await seedTask("F");
    const wtE = await makeWorktree(e, "src/overlap.ts", "export const e = 5;\n");
    const wtF = await makeWorktree(f, "src/overlap.ts", "export const f = 6;\n");
    const items = [
      { taskId: e, dir: wtE },
      { taskId: f, dir: wtF },
    ];
    const eventsRepo = new EventsRepo(db.db);

    await radar.sweep(items);
    const afterFirst = (await eventsRepo.listByType("task.conflict_alert")).length;
    await radar.sweep(items);
    const afterSecond = (await eventsRepo.listByType("task.conflict_alert")).length;

    expect(afterFirst).toBeGreaterThan(0);
    expect(afterSecond).toBe(afterFirst); // 幂等：不再重发
  });
});
