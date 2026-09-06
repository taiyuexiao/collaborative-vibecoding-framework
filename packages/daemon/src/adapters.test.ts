import { describe, expect, it } from "vitest";
import { buildPrompt } from "./client.js";
import { EchoAdapter, adapterByName } from "./adapters.js";

describe("adapters", () => {
  it("echo adapter 落盘产出", async () => {
    const a = new EchoAdapter();
    expect(await a.available()).toBe(true);
  });

  it("adapterByName 未知名称抛错", () => {
    expect(() => adapterByName("nope")).toThrowError(/未知 adapter/);
  });

  it("buildPrompt 无 AGENTS.md 时不注入该节", () => {
    const p = buildPrompt(
      { id: "t", title: "T", description: "", dod: "D", module: null, tags: [], assigneeMemberId: null, assigneeSessionId: null, status: "draft", blockedFrom: null, conflictWith: [], createdAt: "", updatedAt: "" },
      null,
    );
    expect(p).not.toContain("AGENTS.md");
  });
});
