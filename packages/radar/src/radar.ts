import { newId, type Actor, type Task } from "@superteam/core";
import type { DepsRepo, EventsRepo, TasksRepo } from "@superteam/data";
import type { GitProvider } from "@superteam/gitprov";

export interface InFlightItem {
  taskId: string;
  dir: string;
}

export interface FileConflict {
  a: string;
  b: string;
  files: string[];
}

export interface ContractAlert {
  taskId: string;
  downstream: string[];
  files: string[];
}

export interface SweepReport {
  fileConflicts: FileConflict[];
  contractAlerts: ContractAlert[];
}

export interface RadarDeps {
  git: GitProvider;
  tasks: TasksRepo;
  deps: DepsRepo;
  events: EventsRepo;
  baseBranch?: string;
  contractDirs?: string[]; // 默认 specs/ 与 agents/
}

const IN_FLIGHT_STATUSES = ["claimed", "coding", "self_review"] as const;
const systemActor: Actor = { actorType: "system", actorId: "radar" };

export class ConflictRadar {
  private contractDirs: string[];

  constructor(private d: RadarDeps) {
    this.contractDirs = d.contractDirs ?? ["specs/", "agents/"];
  }

  private async emitConflict(payload: unknown): Promise<void> {
    await this.d.events.append({
      id: newId("ev"),
      type: "task.conflict_alert",
      payload,
      actorType: "system",
      actorId: "radar",
      createdAt: new Date().toISOString(),
      consumedAt: null,
    });
  }

  private async addConflictTo(task: Task, otherId: string): Promise<void> {
    if (task.conflictWith.includes(otherId)) return;
    await this.d.tasks.update({
      ...task,
      conflictWith: [...task.conflictWith, otherId],
      updatedAt: new Date().toISOString(),
    });
  }

  /** 单次扫描。dir 不存在/不是 git 工作区的 item 会被跳过（远端任务的分支本机不可见）。 */
  async sweep(items: InFlightItem[]): Promise<SweepReport> {
    const report: SweepReport = { fileConflicts: [], contractAlerts: [] };

    // 1. 收集每个在途任务的改动文件
    const fileSets = new Map<string, string[]>();
    for (const item of items) {
      const task = await this.d.tasks.get(item.taskId);
      if (!task || !IN_FLIGHT_STATUSES.includes(task.status as never)) continue;
      try {
        fileSets.set(item.taskId, await this.d.git.changedFiles(item.dir, this.d.baseBranch ?? "main"));
      } catch {
        // 工作区不可读（如远端成员机器），跳过
      }
    }

    // 2. 两两文件求交
    const entries = [...fileSets.entries()];
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const [aId, aFiles] = entries[i]!;
        const [bId, bFiles] = entries[j]!;
        const inter = aFiles.filter((f) => bFiles.includes(f));
        if (inter.length === 0) continue;
        report.fileConflicts.push({ a: aId, b: bId, files: inter });
        const ta = await this.d.tasks.get(aId);
        const tb = await this.d.tasks.get(bId);
        // 幂等：pair 已在双方 conflictWith 里 → 不重复发事件（避免每次 sweep 刷屏）
        const already = Boolean(ta?.conflictWith.includes(bId) && tb?.conflictWith.includes(aId));
        if (ta) await this.addConflictTo(ta, bId);
        if (tb) await this.addConflictTo(tb, aId);
        if (!already) {
          await this.emitConflict({ kind: "files", a: aId, b: bId, files: inter });
        }
      }
    }

    // 3. 契约变更 → 通知下游
    for (const [taskId, files] of fileSets) {
      const contractFiles = files.filter((f) => this.contractDirs.some((d) => f.startsWith(d)));
      if (contractFiles.length === 0) continue;
      const edges = await this.d.deps.all();
      const downstream = [...new Set(edges.filter((e) => e.dependsOnTaskId === taskId).map((e) => e.taskId))];
      if (downstream.length === 0) continue;
      report.contractAlerts.push({ taskId, downstream, files: contractFiles });
      for (const down of downstream) {
        const t = await this.d.tasks.get(down);
        if (t) await this.addConflictTo(t, taskId);
      }
      await this.emitConflict({ kind: "contract", taskId, downstream, files: contractFiles });
    }

    return report;
  }
}
