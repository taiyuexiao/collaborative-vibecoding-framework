import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ArtifactsRepo, DepsRepo, EventsRepo, TasksRepo, closeDb, createDb, type Db } from "@superteam/data";
import { LocalGitProvider } from "@superteam/gitprov";
import { KnowledgeRepo } from "@superteam/knowledge";
import { newId, type Event } from "@superteam/core";
import { EventConsumer } from "./consumer.js";
import { DigestService } from "./digest.js";
import { NullLlm, OpenAiCompatLlm } from "./llm.js";
import { taskDoneCardRule } from "./rules.js";

let dir: string;
let db: Db;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "st-distill-"));
  db = await createDb(join(dir, "t.db"));
});

afterAll(async () => {
  await closeDb(db);
  rmSync(dir, { recursive: true, force: true });
});

function ev(type: Event["type"], payload: unknown): Event {
  return {
    id: newId("ev"),
    type,
    payload,
    actorType: "human",
    actorId: "spl",
    createdAt: new Date().toISOString(),
    consumedAt: null,
  };
}

describe("蒸馏器", () => {
  const search = { index: () => {}, remove: () => {} };
  let knowledge: KnowledgeRepo;
  const eventsRepo = () => new EventsRepo(db.db);

  beforeAll(async () => {
    knowledge = new KnowledgeRepo({
      knowledgeDir: join(dir, "knowledge"),
      git: new LocalGitProvider(),
      artifacts: new ArtifactsRepo(db.db),
      events: eventsRepo(),
      indexer: search,
    });
    await knowledge.ensureScaffold();
  });

  it("task done → NullLlm 模板卡落盘（actor=agent）", async () => {
    const consumer = new EventConsumer(eventsRepo());
    const rule = taskDoneCardRule({ knowledge, llm: new NullLlm() });
    await eventsRepo().append(
      ev("task.transitioned", {
        taskId: "task_x",
        from: "waiting_review",
        to: "done",
        action: "approve",
        task: { title: "实现批量取消", dod: "幂等", description: "履约模块", module: "order" },
      }),
    );
    const n = await consumer.consumeOnce([rule]);
    expect(n).toBe(1);

    const cards = (await new ArtifactsRepo(db.db).list({ type: "card" })).filter((a) =>
      a.title.includes("实现批量取消"),
    );
    expect(cards.length).toBe(1);
    expect(existsSync(join(dir, "knowledge", cards[0]!.path))).toBe(true);
    const raw = readFileSync(join(dir, "knowledge", cards[0]!.path), "utf8");
    expect(raw).toContain("实现批量取消");

    // 非 done 事件不触发：追加一个 coding 迁移，不产生新卡
    await eventsRepo().append(
      ev("task.transitioned", { taskId: "task_y", from: "claimed", to: "coding", action: "start", task: { title: "Y", dod: "d", description: "", module: null } }),
    );
    await consumer.consumeOnce([rule]);
    const cards2 = (await new ArtifactsRepo(db.db).list({ type: "card" })).filter((a) => a.title.includes("【经验】Y"));
    expect(cards2.length).toBe(0);
  });

  it("毒丸防护：handler 抛错的事件也被 markConsumed", async () => {
    await eventsRepo().append(ev("task.created", { boom: true }));
    const consumer = new EventConsumer(eventsRepo());
    const n = await consumer.consumeOnce([
      {
        name: "boom-rule",
        types: ["task.created"],
        handle: async () => {
          throw new Error("故意失败");
        },
      },
    ]);
    expect(n).toBe(1);
    expect((await eventsRepo().pending()).length).toBe(0);
  });

  it("digest 聚合三类事件成 markdown", async () => {
    const tasksRepo = new TasksRepo(db.db);
    const now = new Date().toISOString();
    const tid = newId("task");
    await tasksRepo.insert({
      id: tid, title: "聚合任务", description: "", dod: "d", module: null, tags: [],
      assigneeMemberId: null, assigneeSessionId: null, status: "done", blockedFrom: null,
      conflictWith: [], createdAt: now, updatedAt: now,
    });
    await eventsRepo().append(ev("task.transitioned", { taskId: tid, from: "waiting_review", to: "done", action: "approve" }));
    await eventsRepo().append(ev("task.conflict_alert", { kind: "files", a: tid, b: "task_other", files: ["x.ts"] }));
    await eventsRepo().append(ev("artifact.proposed", { path: "cards/a.md", title: "卡片A" }));

    const md = await new DigestService({ events: eventsRepo(), tasks: tasksRepo }).generate(24);
    expect(md).toContain("共工日报");
    expect(md).toContain("聚合任务");
    expect(md).toContain("文件重叠");
    expect(md).toContain("卡片A");
  });

  it("OpenAiCompatLlm 请求形状（mock fetch）", async () => {
    let captured: { url: string; body: unknown } | null = null;
    const llm = new OpenAiCompatLlm({
      baseUrl: "https://api.example.com/v4",
      apiKey: "sk-x",
      model: "glm-4.7",
      fetchImpl: (async (url: string, init?: RequestInit) => {
        captured = { url, body: JSON.parse(String(init?.body)) };
        return new Response(JSON.stringify({ choices: [{ message: { content: "好的" } }] }), { status: 200 });
      }) as typeof fetch,
    });
    const out = await llm.complete("sys", "usr");
    expect(out).toBe("好的");
    expect(captured!.url).toBe("https://api.example.com/v4/chat/completions");
    expect(captured!.body).toMatchObject({ model: "glm-4.7", messages: [{ role: "system", content: "sys" }, { role: "user", content: "usr" }] });
  });
});
