import { describe, expect, it } from "vitest";
import { ArtifactSchema, TaskSchema, EventSchema } from "./entities.js";
import { newId } from "./ids.js";

describe("实体 schema", () => {
  it("Task 拒绝空 title 与空 dod", () => {
    const base = {
      id: newId("task"),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    expect(TaskSchema.safeParse({ ...base, title: "", dod: "x" }).success).toBe(false);
    expect(TaskSchema.safeParse({ ...base, title: "t", dod: "" }).success).toBe(false);
    expect(TaskSchema.safeParse({ ...base, title: "t", dod: "done 时无回归" }).success).toBe(true);
  });

  it("Task 默认值：status=draft、tags=[]", () => {
    const t = TaskSchema.parse({
      id: newId("task"),
      title: "t",
      dod: "x",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    expect(t.status).toBe("draft");
    expect(t.tags).toEqual([]);
    expect(t.blockedFrom).toBeNull();
  });

  it("Artifact 校验 type 枚举", () => {
    const base = { id: newId("af"), path: "cards/x.md", title: "x", createdAt: "", updatedAt: "" };
    expect(ArtifactSchema.safeParse({ ...base, type: "card" }).success).toBe(true);
    expect(ArtifactSchema.safeParse({ ...base, type: "tweet" }).success).toBe(false);
  });

  it("Artifact expiresAt 接受 ISO 日期并可为空", () => {
    const base = { id: newId("af"), path: "cards/x.md", title: "x", type: "card", createdAt: "", updatedAt: "" };
    const withExp = ArtifactSchema.parse({ ...base, expiresAt: "2026-12-06" });
    expect(withExp.expiresAt).toBe("2026-12-06");
  });

  it("Event payload 允许任意 JSON", () => {
    const e = EventSchema.parse({
      id: newId("ev"),
      type: "task.transitioned",
      payload: { from: "draft", to: "claimed", nested: { ok: true } },
      actorType: "human",
      actorId: "m1",
      createdAt: new Date().toISOString(),
    });
    expect(e.consumedAt).toBeNull();
  });
});
