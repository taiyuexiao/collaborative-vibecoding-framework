import type { Task, TaskAction, TaskStatus } from "./entities.js";
import { AppError } from "./errors.js";

/**
 * 迁移表：TRANSITIONS[status][action] = nextStatus。
 * block 的目标是 blocked 但需要记录来源状态，resume 返回来源状态——两者在 transition() 中特判；
 * 表中以 "SELF" 占位（resume 的真实去向由 task.blockedFrom 决定）。
 */
export const TRANSITIONS: Record<TaskStatus, Partial<Record<TaskAction, TaskStatus | "SELF">>> = {
  draft: { claim: "claimed", cancel: "canceled" },
  claimed: { start: "coding", block: "blocked", cancel: "canceled" },
  coding: { selfReview: "self_review", submit: "waiting_review", block: "blocked", cancel: "canceled" },
  self_review: { submit: "waiting_review", block: "blocked", cancel: "canceled" },
  waiting_review: { approve: "done", requestChanges: "coding", block: "blocked", cancel: "canceled" },
  blocked: { resume: "SELF", cancel: "canceled" },
  done: {},
  canceled: {},
};

/** resume 返回的来源状态由 task.blockedFrom 决定，表中以 "SELF" 占位。 */
export function transition(task: Task, action: TaskAction): Task {
  const table = TRANSITIONS[task.status];
  const next = table[action];

  if (next === undefined) {
    throw new AppError(
      "ILLEGAL_TRANSITION",
      `非法状态迁移：${task.status} --${action}--> ？（合法 action：${allowedActions(task.status).join(", ") || "无"}）`,
      { from: task.status, action },
    );
  }

  const now = new Date().toISOString();

  if (action === "block") {
    return { ...task, status: "blocked", blockedFrom: task.status, updatedAt: now };
  }
  if (action === "resume") {
    return { ...task, status: task.blockedFrom ?? "draft", blockedFrom: null, updatedAt: now };
  }
  // 走到这里 next 不可能是 "SELF"（仅 resume 使用），收窄类型
  const status = next as TaskStatus;
  return { ...task, status, updatedAt: now };
}

export function allowedActions(status: TaskStatus): TaskAction[] {
  return Object.keys(TRANSITIONS[status]) as TaskAction[];
}
