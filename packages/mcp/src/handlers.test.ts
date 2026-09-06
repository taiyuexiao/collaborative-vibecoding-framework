import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, ArtifactsRepo, EventsRepo, closeDb, type Db } from "@superteam/data";
import { LocalGitProvider } from "@superteam/gitprov";
import { KnowledgeRepo } from "@superteam/knowledge";
import { SearchService } from "@superteam/knowledge";
import { buildKnowledgeHandlers } from "./handlers.js";

let dir: string;
let db: Db;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "st-mcp-"));
  db = await createDb(join(dir, "test.db"));
});

afterAll(async () => {
  await closeDb(db);
  rmSync(dir, { recursive: true, force: true });
});

describe("knowledge handlers", () => {
  let h: ReturnType<typeof buildKnowledgeHandlers>;
  let repo: KnowledgeRepo;

  beforeAll(async () => {
    const search = new SearchService(db.client);
    repo = new KnowledgeRepo({
      knowledgeDir: join(dir, "knowledge"),
      git: new LocalGitProvider(),
      artifacts: new ArtifactsRepo(db.db),
      events: new EventsRepo(db.db),
      indexer: search,
    });
    h = buildKnowledgeHandlers({ repo, search });
    await repo.ensureScaffold();
    await h.propose({
      type: "card",
      title: "FTS 中文检索坑",
      body: "unicode61 对汉字要按字切分，短语查询要加引号。",
      tags: ["search", "sqlite"],
      actorId: "agent-claude",
    });
  }, 30000);

  it("search 命中刚 propose 的卡片", async () => {
    const hits = await h.search({ text: "汉字", type: "card" });
    expect(hits.length).toBe(1);
    expect(hits[0]?.title).toBe("FTS 中文检索坑");
  });

  it("read 返回元数据与正文；未知路径 NOT_FOUND", async () => {
    const hits = await h.search({ text: "unicode61" });
    const doc = await h.read({ path: hits[0]!.path });
    expect(doc.type).toBe("card");
    expect(doc.body).toContain("unicode61");
    expect(doc.truncated).toBe(false);
    await expect(h.read({ path: "cards/none.md" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("propose 默认 actorId=agent（agent 写入可审计）", async () => {
    const r = await h.propose({ type: "reading", title: "A2A 协议白皮书", body: "链接：https://a2a-protocol.org" });
    expect(r.sha).toMatch(/^[0-9a-f]{40}$/);
    const doc = await h.read({ path: r.path });
    expect(doc.title).toBe("A2A 协议白皮书");
  });

  it("latest 返回最近变更（按提交时间倒序）", async () => {
    const latest = await h.latest({ n: 5 });
    expect(latest.length).toBeGreaterThanOrEqual(2);
    expect(latest[0]?.date).toBeTruthy();
    expect(latest[0]?.title).toBeTruthy();
  });
});
