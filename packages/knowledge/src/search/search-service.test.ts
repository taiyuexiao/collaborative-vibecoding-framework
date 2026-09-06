import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@libsql/client";
import { SearchService, buildMatchQuery, toSearchable } from "./search-service.js";

let dir: string;
let svc: SearchService;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "st-search-"));
  const client = createClient({ url: `file:${join(dir, "t.db")}` });
  await client.executeMultiple(`CREATE VIRTUAL TABLE IF NOT EXISTS artifact_fts USING fts5(
    path UNINDEXED, title, tags, body, tokenize='unicode61')`);
  svc = new SearchService(client);

  await svc.index("cards/a.md", "支付回调幂等坑", ["java", "idempotency"], "回调重复扣款，需要幂等处理，用 idempotency-key");
  await svc.index("specs/order.md", "订单模块", ["order", "java"], "订单履约批量取消接口设计");
  await svc.index("readings/r.md", "Agent 协作综述", ["reading", "ai"], "multi-agent collaboration survey");
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("纯函数", () => {
  it("toSearchable 把相邻汉字切开、latin 不动", () => {
    expect(toSearchable("支付idempotent处理")).toBe("支 付 idempotent 处 理");
  });

  it("buildMatchQuery：CJK→短语、多词 AND、引号剔除", () => {
    expect(buildMatchQuery("支付 幂等")).toBe(`"支 付" AND "幂 等"`);
    expect(buildMatchQuery("idempotency key")).toBe(`"idempotency" AND "key"`);
    expect(buildMatchQuery('  "支付" ')).toBe(`"支 付"`);
    expect(buildMatchQuery("   ")).toBeNull();
  });
});

describe("SearchService", () => {
  it("中文短语命中相邻内容", async () => {
    const hits = await svc.query({ text: "幂等" });
    expect(hits.map((h) => h.path)).toContain("cards/a.md");
    expect(hits[0]?.snippet).toContain("幂");
  });

  it("中文查询不误命中无该词的文档", async () => {
    const hits = await svc.query({ text: "履约批量" });
    expect(hits.map((h) => h.path)).toContain("specs/order.md");
    expect(hits.map((h) => h.path)).not.toContain("cards/a.md");
  });

  it("latin 词与标签命中", async () => {
    expect((await svc.query({ text: "multi-agent" })).map((h) => h.path)).toContain("readings/r.md");
    expect((await svc.query({ text: "idempotency" })).map((h) => h.path)).toContain("cards/a.md");
  });

  it("type 按路径前缀过滤", async () => {
    const all = await svc.query({ type: "card" });
    expect(all.map((h) => h.path)).toEqual(["cards/a.md"]);
  });

  it("tags 过滤为 AND 语义", async () => {
    expect((await svc.query({ tags: ["java"] })).length).toBe(2);
    expect((await svc.query({ tags: ["java", "order"] })).map((h) => h.path)).toEqual(["specs/order.md"]);
  });

  it("空查询退化为过滤列表", async () => {
    expect((await svc.query({})).length).toBe(3);
  });

  it("remove 后不再命中", async () => {
    await svc.remove("readings/r.md");
    expect((await svc.query({ text: "collaboration" })).length).toBe(0);
  });
});
