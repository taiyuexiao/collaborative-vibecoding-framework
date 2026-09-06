import { describe, expect, it } from "vitest";
import { newId } from "./ids.js";
import type { Task } from "./entities.js";
import { allowedActions, transition } from "./state-machine.js";
import { AppError } from "./errors.js";

function makeTask(status: Task["status"] = "draft", blockedFrom: Task["blockedFrom"] = null): Task {
  return {
    id: newId("task"),
    title: "t",
    description: "",
    dod: "有验收标准",
    module: null,
    tags: [],
    assigneeMemberId: null,
    assigneeSessionId: null,
    status,
    blockedFrom,
    conflictWith: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe("任务状态机", () => {
  it("主路径 draft→claimed→coding→self_review→waiting_review→done", () => {
    let t = makeTask();
    t = transition(t, "claim");
    expect(t.status).toBe("claimed");
    t = transition(t, "start");
    expect(t.status).toBe("coding");
    t = transition(t, "selfReview");
    expect(t.status).toBe("self_review");
    t = transition(t, "submit");
    expect(t.status).toBe("waiting_review");
    t = transition(t, "approve");
    expect(t.status).toBe("done");
  });

  it("coding 可直接 submit 跳过自检；requestChanges 返工回 coding", () => {
    let t = transition(makeTask(), "claim");
    t = transition(t, "start");
    t = transition(t, "submit");
    expect(t.status).toBe("waiting_review");
    t = transition(t, "requestChanges");
    expect(t.status).toBe("coding");
  });

  it.each(["claimed", "coding", "self_review", "waiting_review"] as const)(
    "block/resume 从 %s 精确往返",
    (from) => {
      let t = makeTask(from);
      t = transition(t, "block");
      expect(t.status).toBe("blocked");
      expect(t.blockedFrom).toBe(from);
      t = transition(t, "resume");
      expect(t.status).toBe(from);
      expect(t.blockedFrom).toBeNull();
    },
  );

  it("blocked 状态允许 resume 与 cancel", () => {
    expect(allowedActions("blocked")).toEqual(["resume", "cancel"]);
  });

  it.each(["done", "canceled"] as const)("终态 %s 拒绝一切 action", (from) => {
    for (const action of allowedActions(from)) {
      expect(() => transition(makeTask(from), action)).toThrowError(AppError);
    }
  });

  it.each(["draft", "claimed", "coding", "self_review", "waiting_review", "blocked"] as const)(
    "%s 可 cancel",
    (from) => {
      expect(transition(makeTask(from), "cancel").status).toBe("canceled");
    },
  );

  it("非法迁移抛 AppError 且 details 携带 from/action", () => {
    try {
      transition(makeTask("draft"), "approve");
      expect.unreachable("应当抛出");
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      const err = e as AppError;
      expect(err.code).toBe("ILLEGAL_TRANSITION");
      expect(err.details).toEqual({ from: "draft", action: "approve" });
    }
  });

  it("transition 更新 updatedAt", () => {
    const t = makeTask();
    const t2 = transition(t, "claim");
    expect(new Date(t2.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(t.updatedAt).getTime());
  });
});
