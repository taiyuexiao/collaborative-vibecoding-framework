import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ArtifactsRepo, EventsRepo, closeDb, createDb, type Db } from "@superteam/data";
import { LocalGitProvider } from "@superteam/gitprov";
import { newId, type Actor } from "@superteam/core";
import { KnowledgeRepo } from "./knowledge-repo.js";

let dir: string;
let db: Db;
const git = new LocalGitProvider();
const human: Actor = { actorType: "human", actorId: "spl" };

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "st-know-"));
  db = await createDb(join(dir, "test.db"));
});

afterAll(async () => {
  await closeDb(db);
  rmSync(dir, { recursive: true, force: true });
});

describe("KnowledgeRepo", () => {
  const indexed: string[] = [];
  let repo: KnowledgeRepo;

  beforeAll(async () => {
    repo = new KnowledgeRepo({
      knowledgeDir: join(dir, "knowledge"),
      git,
      artifacts: new ArtifactsRepo(db.db),
      events: new EventsRepo(db.db),
      indexer: {
        index: (path) => {
          indexed.push(path);
        },
        remove: (path) => {
          const i = indexed.indexOf(path);
          if (i >= 0) indexed.splice(i, 1);
        },
      },
    });
    await repo.ensureScaffold();
    await repo.ensureScaffold(); // 幂等
  });

  it("scaffold 创建五目录与 .gitkeep", () => {
    for (const d of ["specs", "adr", "cards", "readings", "agents"]) {
      expect(existsSync(join(dir, "knowledge", d, ".gitkeep"))).toBe(true);
    }
  });

  it("propose card：文件落盘 + frontmatter 完整 + commit + 事件 + 索引", async () => {
    const { path, sha } = await repo.propose({
      type: "card",
      title: "支付回调幂等坑",
      body: "## 现象\n回调重复扣款。",
      tags: ["java", "idempotency"],
      owner: "spl",
      expires: "2026-12-31",
      actor: human,
    });
    expect(path).toMatch(/^cards\/\d{4}-\d{2}-\d{2}-支付回调幂等坑\.md$/);
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    expect(existsSync(join(dir, "knowledge", path))).toBe(true);

    const raw = readFileSync(join(dir, "knowledge", path), "utf8");
    expect(raw).toContain("title: 支付回调幂等坑");

    const byPath = await new ArtifactsRepo(db.db).getByPath(path);
    expect(byPath?.title).toBe("支付回调幂等坑");
    const events = await new EventsRepo(db.db).listByType("artifact.proposed");
    expect(events.length).toBe(1);
    expect(indexed).toContain(path);
  });

  it("adr 连续自动编号", async () => {
    const a = await repo.propose({ type: "adr", title: "引入 FTS", body: "决策。", actor: human, status: "accepted" });
    const b = await repo.propose({ type: "adr", title: "使用 worktree", body: "决策。", actor: human });
    expect(a.path).toBe("adr/0001-引入-fts.md");
    expect(b.path).toBe("adr/0002-使用-worktree.md");
  });

  it("spec 同 slug 更新而非新建", async () => {
    const p1 = await repo.propose({ type: "spec", title: "订单模块", body: "v1", actor: human });
    const p2 = await repo.propose({ type: "spec", title: "订单模块", body: "v2", actor: human });
    expect(p1.path).toBe(p2.path);
    const raw = readFileSync(join(dir, "knowledge", p2.path), "utf8");
    expect(raw).toContain("v2");
  });

  it("scan：索引合法文件、跳过坏文件、清除残留行", async () => {
    writeFileSync(join(dir, "knowledge", "cards", "2026-09-06-good.md"), "---\ntitle: good\ntags: [t1]\n---\n正文");
    writeFileSync(join(dir, "knowledge", "cards", "2026-09-06-bad.md"), "---\ntitle: ''\n---\n");

    const list = await repo.scan();
    expect(list.map((a) => a.title)).toContain("good");
    expect(list.map((a) => a.title)).not.toContain("bad");
    expect(indexed).toContain("cards/2026-09-06-good.md");

    const ar = new ArtifactsRepo(db.db);
    await ar.upsert({
      id: newId("af"),
      type: "spec",
      path: "specs/ghost.md",
      title: "ghost",
      tags: [],
      owner: null,
      status: "accepted",
      expiresAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await repo.scan();
    expect(await ar.getByPath("specs/ghost.md")).toBeNull();
    expect(indexed).not.toContain("specs/ghost.md");
  });

  it("read 未知路径 NOT_FOUND；history 非空（仅对已提交文件）", async () => {
    await expect(repo.read("cards/none.md")).rejects.toMatchObject({ code: "NOT_FOUND" });
    const today = new Date().toISOString().slice(0, 10);
    const h = await repo.history(`cards/${today}-支付回调幂等坑.md`); // propose 已提交
    expect(h.length).toBeGreaterThanOrEqual(1);
    const hUncommitted = await repo.history("cards/2026-09-06-good.md"); // scan 只读不提交
    expect(hUncommitted.length).toBe(0);
  });
});
