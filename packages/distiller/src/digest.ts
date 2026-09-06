import type { EventsRepo, TasksRepo } from "@superteam/data";

/** 聚合近期事件生成 markdown digest（M6 会接通知出口推送）。 */
export class DigestService {
  constructor(
    private d: { events: EventsRepo; tasks: TasksRepo },
  ) {}

  async generate(sinceHours = 24): Promise<string> {
    const since = new Date(Date.now() - sinceHours * 3600_000).toISOString();
    const lines: string[] = [`# 共工日报（近 ${sinceHours} 小时）`, ""];

    const transitions = (await this.d.events.listByType("task.transitioned", 200)).filter(
      // 注意：不看 consumedAt——被蒸馏器消费 ≠ 没发生过；日报反映活动历史而非队列状态
      (e) => e.createdAt >= since,
    );
    lines.push(`## 任务动态（${transitions.length}）`);
    for (const e of transitions.slice(0, 20)) {
      const p = e.payload as { taskId?: string; from?: string; to?: string };
      const task = p.taskId ? await this.d.tasks.get(p.taskId) : null;
      lines.push(`- ${task?.title ?? p.taskId}：${p.from} → ${p.to}`);
    }
    if (transitions.length === 0) lines.push("-（无）");

    const conflicts = (await this.d.events.listByType("task.conflict_alert", 100)).filter(
      (e) => e.createdAt >= since,
    );
    lines.push("", `## 冲突预警（${conflicts.length}）`);
    for (const e of conflicts.slice(0, 10)) {
      const p = e.payload as { kind?: string; a?: string; b?: string; taskId?: string; downstream?: string[] };
      if (p.kind === "files") lines.push(`- 文件重叠：${p.a} × ${p.b}`);
      else lines.push(`- 契约变更：${p.taskId} → 下游 ${(p.downstream ?? []).join(", ")}`);
    }
    if (conflicts.length === 0) lines.push("-（无）");

    const artifacts = (await this.d.events.listByType("artifact.proposed", 100)).filter(
      (e) => e.createdAt >= since,
    );
    lines.push("", `## 新沉淀知识（${artifacts.length}）`);
    for (const e of artifacts.slice(0, 10)) {
      const p = e.payload as { path?: string; title?: string };
      lines.push(`- ${p.title ?? ""}（${p.path ?? ""}）`);
    }
    if (artifacts.length === 0) lines.push("-（无）");

    return lines.join("\n");
  }
}
