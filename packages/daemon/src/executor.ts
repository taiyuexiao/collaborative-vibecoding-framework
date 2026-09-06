import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Task } from "@superteam/core";
import type { Logger } from "@superteam/infra";
import { LocalGitProvider } from "@superteam/gitprov";
import { buildPrompt, type AgentAdapter, type DaemonClientLike } from "./client.js";

export interface TaskExecutorDeps {
  client: DaemonClientLike;
  adapter: AgentAdapter;
  /** 任务源仓库（main 所在）；worktree 创建在这里。 */
  repoDir: string;
  worktreeRoot: string;
  baseBranch?: string;
  logger?: Logger;
}

export interface TickResult {
  claimed: boolean;
  taskId?: string;
  outcome?: "submitted" | "blocked";
  reason?: string;
}

export class TaskExecutor {
  private git = new LocalGitProvider();
  private sessionId: string | null = null;

  constructor(private d: TaskExecutorDeps) {}

  async ensureSession(): Promise<string> {
    if (!this.sessionId) {
      const s = await this.d.client.register(this.d.adapter.name);
      this.sessionId = s.id;
    }
    return this.sessionId;
  }

  /** 单次领取-执行-回写。无可认领任务时返回 {claimed:false}。 */
  async tick(): Promise<TickResult> {
    const sessionId = await this.ensureSession();
    const base = this.d.baseBranch ?? "main";

    const tasks = await this.d.client.listTasks();
    const candidates = tasks
      .filter((t) => t.status === "draft")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (candidates.length === 0) return { claimed: false };

    const task: Task = candidates[0]!;
    const taskId = task.id;
    const log = this.d.logger;

    try {
      // 1. 认领
      await this.d.client.transition(taskId, "claim");
      await this.d.client.heartbeat(sessionId, { status: "claimed", taskId, branch: null });

      // 2. 隔离工作区
      const branch = `task/${taskId}`;
      const worktree = join(this.d.worktreeRoot, taskId);
      await this.git.ensureRepo(this.d.repoDir);
      await this.git.ensureWorktree(this.d.repoDir, worktree, branch);

      // 3. 组装 prompt（任务 + DoD + AGENTS.md）
      const agentsPath = join(this.d.repoDir, "agents", "AGENTS.md");
      const agentsDoc = existsSync(agentsPath) ? readFileSync(agentsPath, "utf8") : null;
      const prompt = buildPrompt(task, agentsDoc);

      // 4. 驱动 agent（状态机：claimed --start--> coding）
      await this.d.client.transition(taskId, "start");
      await this.d.client.heartbeat(sessionId, { status: "coding", branch });
      if (!(await this.d.adapter.available())) {
        throw new Error(`adapter ${this.d.adapter.name} 不可用`);
      }
      const result = await this.d.adapter.run({ prompt, workdir: worktree });
      if (result.exitCode !== 0) {
        throw new Error(`agent 退出码 ${result.exitCode}：${result.output.slice(0, 300)}`);
      }

      // 5. 收口提交 + diff 统计（只上报清单，不上报内容）
      await this.git.commitAll(worktree, `task(${taskId}): ${task.title}`);
      const files = await this.git.changedFiles(worktree, base);
      const diffSummary = files.length === 0 ? "no changes" : `${files.length} files: ${files.slice(0, 5).join(", ")}${files.length > 5 ? " …" : ""}`;

      // 6. 自检 + 提交评审
      await this.d.client.transition(taskId, "submit");
      await this.d.client.heartbeat(sessionId, {
        status: "self_review",
        taskId: null,
        branch,
        diffSummary,
      });
      log?.info({ taskId, diffSummary }, "任务完成并提交评审");
      return { claimed: true, taskId, outcome: "submitted" };
    } catch (err) {
      const reason = (err as Error).message;
      log?.error({ taskId, reason }, "任务执行失败，转 blocked");
      try {
        await this.d.client.transition(taskId, "block");
      } catch {
        /* 已 blocked 或状态不允许时忽略 */
      }
      await this.d.client.heartbeat(sessionId, { status: "blocked", taskId, diffSummary: `ERROR: ${reason.slice(0, 200)}` });
      return { claimed: true, taskId, outcome: "blocked", reason };
    }
  }

  runLoop(intervalMs: number): void {
    const loop = async () => {
      try {
        await this.tick();
      } catch (err) {
        this.d.logger?.error({ err }, "tick 异常");
      }
      setTimeout(() => void loop(), intervalMs);
    };
    void loop();
  }
}
