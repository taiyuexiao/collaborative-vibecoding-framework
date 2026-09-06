import type { Task } from "@superteam/core";

export interface DaemonClientLike {
  register(adapter: string): Promise<{ id: string }>;
  heartbeat(
    sessionId: string,
    patch: { status?: string; taskId?: string | null; branch?: string | null; diffSummary?: string | null },
  ): Promise<unknown>;
  listTasks(): Promise<Task[]>;
  transition(id: string, action: string): Promise<Task>;
}

export function buildPrompt(task: Task, agentsDoc?: string | null): string {
  const lines = [
    `# 任务：${task.title}`,
    "",
    `## 描述`,
    task.description || "（无）",
    "",
    `## 验收标准（DoD，必须全部满足）`,
    task.dod,
    "",
    `## 约束`,
    `- 只在当前工作目录内改动；完成后无需自行提交（由 superteam daemon 统一提交）。`,
    task.module ? `- 本任务属于模块「${task.module}」，遵守该模块相关规范。` : ``,
  ].filter(Boolean);

  if (agentsDoc) {
    lines.push("", `## 团队 AGENTS.md`, agentsDoc.trim());
  }
  return lines.join("\n");
}

export class DaemonClient implements DaemonClientLike {
  constructor(
    private serverUrl: string,
    private token: string,
  ) {}

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const r = await fetch(`${this.serverUrl}/api/v1${path}`, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${this.token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await r.json()) as { error?: { message?: string } };
    if (!r.ok) throw new Error(data?.error?.message ?? `HTTP ${r.status} ${path}`);
    return data as T;
  }

  register(adapter: string) {
    return this.req<{ id: string }>("POST", "/sessions/register", { adapter });
  }

  heartbeat(sessionId: string, patch: Parameters<DaemonClientLike["heartbeat"]>[1]) {
    return this.req<unknown>("POST", `/sessions/${sessionId}/heartbeat`, patch);
  }

  listTasks() {
    return this.req<Task[]>("GET", "/tasks");
  }

  transition(id: string, action: string) {
    return this.req<Task>("POST", `/tasks/${id}/transition`, { action });
  }
}
