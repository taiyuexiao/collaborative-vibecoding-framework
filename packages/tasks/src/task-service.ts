import { z } from "zod";
import {
  AppError,
  newId,
  transition as coreTransition,
  type Actor,
  type Task,
  type TaskAction,
  type TaskDep,
} from "@superteam/core";
import type { DepsRepo, EventsRepo, TasksRepo } from "@superteam/data";

export interface CreateTaskInput {
  title: string;
  description?: string;
  dod: string;
  module?: string;
  tags?: string[];
  assigneeMemberId?: string;
}

const CreateTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().default(""),
  dod: z.string().min(1, "DoD（验收标准）必填"),
  module: z.string().nullable().optional(),
  tags: z.array(z.string()).default([]),
  assigneeMemberId: z.string().nullable().optional(), // 与 core TaskSchema 的 nullable 对齐；负责人未定时传 null
});

const SetDepsSchema = z.object({
  dependsOnTaskId: z.string().min(1),
  kind: z.enum(["interface", "sequence"]).default("sequence"),
});

export interface TaskServiceDeps {
  tasks: TasksRepo;
  deps: DepsRepo;
  events: EventsRepo;
}

export class TaskService {
  constructor(private d: TaskServiceDeps) {}

  private async emit(type: "task.created" | "task.transitioned" | "task.dep_changed", payload: unknown, actor: Actor): Promise<void> {
    await this.d.events.append({
      id: newId("ev"),
      type,
      payload,
      actorType: actor.actorType,
      actorId: actor.actorId,
      createdAt: new Date().toISOString(),
      consumedAt: null,
    });
  }

  async create(input: CreateTaskInput, actor: Actor): Promise<Task> {
    const parsed = CreateTaskSchema.safeParse(input);
    if (!parsed.success) {
      throw new AppError("VALIDATION_FAILED", "任务字段校验失败", parsed.error.flatten());
    }
    const now = new Date().toISOString();
    const task: Task = {
      id: newId("task"),
      title: parsed.data.title,
      description: parsed.data.description,
      dod: parsed.data.dod,
      module: parsed.data.module ?? null,
      tags: parsed.data.tags,
      assigneeMemberId: parsed.data.assigneeMemberId ?? null,
      assigneeSessionId: null,
      status: "draft",
      blockedFrom: null,
      conflictWith: [],
      createdAt: now,
      updatedAt: now,
    };
    await this.d.tasks.insert(task);
    await this.emit("task.created", { taskId: task.id, title: task.title, module: task.module }, actor);
    return task;
  }

  async get(id: string): Promise<Task> {
    const t = await this.d.tasks.get(id);
    if (!t) throw new AppError("NOT_FOUND", `任务不存在：${id}`);
    return t;
  }

  async list(f?: { status?: Task["status"]; module?: string; assigneeMemberId?: string }): Promise<Task[]> {
    return this.d.tasks.list(f);
  }

  async transition(id: string, action: TaskAction, actor: Actor): Promise<Task> {
    const current = await this.get(id);
    const next = coreTransition(current, action); // 非法迁移在这里抛，不落库
    await this.d.tasks.update(next);
    // 负载携带任务快照：蒸馏器等下游消费者无需回查即可起草
    await this.emit(
      "task.transitioned",
      {
        taskId: id,
        from: current.status,
        to: next.status,
        action,
        task: { title: next.title, dod: next.dod, description: next.description, module: next.module },
      },
      actor,
    );
    return next;
  }

  async setDeps(
    id: string,
    edges: { dependsOnTaskId: string; kind?: "interface" | "sequence" }[],
    actor: Actor,
  ): Promise<TaskDep[]> {
    await this.get(id); // 存在性
    const parsed = z.array(SetDepsSchema).min(0).safeParse(edges);
    if (!parsed.success) {
      throw new AppError("VALIDATION_FAILED", "依赖边字段校验失败", parsed.error.flatten());
    }
    // 两端存在性
    for (const e of parsed.data) {
      await this.get(e.dependsOnTaskId);
    }

    // setDeps = PUT 语义：整体替换该任务的依赖集合。
    // 环检测必须看全库边（他人任务的边 + 本任务的新边），否则 b→c 存在时 c→b 检不出环。
    const existing = await this.d.deps.forTask(id);
    const others = (await this.d.deps.all()).filter((e) => e.taskId !== id);
    const newEdges: TaskDep[] = parsed.data.map((e) => ({
      taskId: id,
      dependsOnTaskId: e.dependsOnTaskId,
      kind: e.kind ?? "sequence",
    }));

    const graph = new Map<string, string[]>();
    for (const e of [...others, ...newEdges]) {
      const list = graph.get(e.taskId) ?? [];
      list.push(e.dependsOnTaskId);
      graph.set(e.taskId, list);
    }
    const visiting = new Set<string>();
    const dfs = (node: string, target: string): boolean => {
      if (node === target && visiting.has(node)) return true;
      if (visiting.has(node)) return false;
      visiting.add(node);
      for (const next of graph.get(node) ?? []) {
        if (next === target) return true;
        if (dfs(next, target)) return true;
      }
      visiting.delete(node);
      return false;
    };
    if (dfs(id, id)) {
      throw new AppError("CYCLIC_DEPEND", "依赖边会构成环", { taskId: id });
    }

    // 写入：清空本任务现有边，写入新集合（他人任务的边不动）
    for (const e of existing) {
      await this.d.deps.remove(id, e.dependsOnTaskId);
    }
    for (const e of newEdges) {
      await this.d.deps.add(e);
    }
    await this.emit("task.dep_changed", { taskId: id, deps: newEdges }, actor);
    return newEdges;
  }

  async getDeps(id: string): Promise<TaskDep[]> {
    await this.get(id);
    return this.d.deps.forTask(id);
  }

  /** 谁依赖我（下游）。雷达的契约变更通知用。 */
  async downstreamOf(id: string): Promise<Task[]> {
    const edges = await this.d.deps.all();
    const downstreamIds = edges.filter((e) => e.dependsOnTaskId === id).map((e) => e.taskId);
    const out: Task[] = [];
    for (const tid of [...new Set(downstreamIds)]) {
      const t = await this.d.tasks.get(tid);
      if (t) out.push(t);
    }
    return out;
  }
}
