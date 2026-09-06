import { eq, and, isNull, desc, sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import type { AgentSession, Artifact, Event, Member, Task, TaskDep } from "@superteam/core";
import * as t from "./schema.js";

export type Schema = typeof t;

function toJson(v: unknown): string {
  return JSON.stringify(v ?? []);
}
function fromJson<T>(s: string | null): T[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

/* ---------------- members ---------------- */

export class MembersRepo {
  constructor(private d: LibSQLDatabase<Schema>) {}

  async insert(m: Member): Promise<void> {
    await this.d.insert(t.members).values({
      id: m.id,
      name: m.name,
      role: m.role,
      tokenHash: m.tokenHash,
      createdAt: m.createdAt,
    });
  }

  async get(id: string): Promise<Member | null> {
    const rows = await this.d.select().from(t.members).where(eq(t.members.id, id)).limit(1);
    const r = rows[0];
    return r ? { ...r, role: r.role as Member["role"] } : null;
  }

  async getByName(name: string): Promise<Member | null> {
    const rows = await this.d.select().from(t.members).where(eq(t.members.name, name)).limit(1);
    const r = rows[0];
    return r ? { ...r, role: r.role as Member["role"] } : null;
  }

  async list(): Promise<Member[]> {
    const rows = await this.d.select().from(t.members);
    return rows.map((r) => ({ ...r, role: r.role as Member["role"] }));
  }
}

/* ---------------- tasks ---------------- */

function taskRowToDomain(r: typeof t.tasks.$inferSelect): Task {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    dod: r.dod,
    module: r.module,
    tags: fromJson<string>(r.tags),
    assigneeMemberId: r.assigneeMemberId,
    assigneeSessionId: r.assigneeSessionId,
    status: r.status as Task["status"],
    blockedFrom: (r.blockedFrom ?? null) as Task["blockedFrom"],
    conflictWith: fromJson<string>(r.conflictWith),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export class TasksRepo {
  constructor(private d: LibSQLDatabase<Schema>) {}

  async insert(x: Task): Promise<void> {
    await this.d.insert(t.tasks).values({
      id: x.id,
      title: x.title,
      description: x.description,
      dod: x.dod,
      module: x.module,
      tags: toJson(x.tags),
      assigneeMemberId: x.assigneeMemberId,
      assigneeSessionId: x.assigneeSessionId,
      status: x.status,
      blockedFrom: x.blockedFrom,
      conflictWith: toJson(x.conflictWith),
      createdAt: x.createdAt,
      updatedAt: x.updatedAt,
    });
  }

  async update(x: Task): Promise<void> {
    await this.d
      .update(t.tasks)
      .set({
        title: x.title,
        description: x.description,
        dod: x.dod,
        module: x.module,
        tags: toJson(x.tags),
        assigneeMemberId: x.assigneeMemberId,
        assigneeSessionId: x.assigneeSessionId,
        status: x.status,
        blockedFrom: x.blockedFrom,
        conflictWith: toJson(x.conflictWith),
        updatedAt: x.updatedAt,
      })
      .where(eq(t.tasks.id, x.id));
  }

  async get(id: string): Promise<Task | null> {
    const rows = await this.d.select().from(t.tasks).where(eq(t.tasks.id, id)).limit(1);
    return rows[0] ? taskRowToDomain(rows[0]) : null;
  }

  async list(f: { status?: Task["status"]; module?: string; assigneeMemberId?: string } = {}): Promise<Task[]> {
    const conds = [];
    if (f.status) conds.push(eq(t.tasks.status, f.status));
    if (f.module) conds.push(eq(t.tasks.module, f.module));
    if (f.assigneeMemberId) conds.push(eq(t.tasks.assigneeMemberId, f.assigneeMemberId));
    const q = this.d.select().from(t.tasks);
    const rows = conds.length
      ? await q.where(conds.length === 1 ? conds[0] : and(...conds))
      : await q;
    return rows.map(taskRowToDomain).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}

/* ---------------- task deps ---------------- */

export class DepsRepo {
  constructor(private d: LibSQLDatabase<Schema>) {}

  async add(x: TaskDep): Promise<void> {
    await this.d
      .insert(t.taskDeps)
      .values({ taskId: x.taskId, dependsOnTaskId: x.dependsOnTaskId, kind: x.kind })
      .onConflictDoNothing();
  }

  async remove(taskId: string, dependsOnTaskId: string): Promise<void> {
    await this.d
      .delete(t.taskDeps)
      .where(and(eq(t.taskDeps.taskId, taskId), eq(t.taskDeps.dependsOnTaskId, dependsOnTaskId)));
  }

  async forTask(taskId: string): Promise<TaskDep[]> {
    const rows = await this.d.select().from(t.taskDeps).where(eq(t.taskDeps.taskId, taskId));
    return rows.map((r) => ({ taskId: r.taskId, dependsOnTaskId: r.dependsOnTaskId, kind: r.kind as TaskDep["kind"] }));
  }

  async all(): Promise<TaskDep[]> {
    const rows = await this.d.select().from(t.taskDeps);
    return rows.map((r) => ({ taskId: r.taskId, dependsOnTaskId: r.dependsOnTaskId, kind: r.kind as TaskDep["kind"] }));
  }
}

/* ---------------- sessions ---------------- */

function sessionRowToDomain(r: typeof t.sessions.$inferSelect): AgentSession {
  return {
    id: r.id,
    memberId: r.memberId,
    adapter: r.adapter as AgentSession["adapter"],
    taskId: r.taskId,
    branch: r.branch,
    status: r.status as AgentSession["status"],
    diffSummary: r.diffSummary,
    lastHeartbeatAt: r.lastHeartbeatAt,
  };
}

export class SessionsRepo {
  constructor(private d: LibSQLDatabase<Schema>) {}

  async upsert(s: AgentSession): Promise<void> {
    await this.d
      .insert(t.sessions)
      .values({
        id: s.id,
        memberId: s.memberId,
        adapter: s.adapter,
        taskId: s.taskId,
        branch: s.branch,
        status: s.status,
        diffSummary: s.diffSummary,
        lastHeartbeatAt: s.lastHeartbeatAt,
      })
      .onConflictDoUpdate({
        target: t.sessions.id,
        set: {
          memberId: s.memberId,
          adapter: s.adapter,
          taskId: s.taskId,
          branch: s.branch,
          status: s.status,
          diffSummary: s.diffSummary,
          lastHeartbeatAt: s.lastHeartbeatAt,
        },
      });
  }

  async get(id: string): Promise<AgentSession | null> {
    const rows = await this.d.select().from(t.sessions).where(eq(t.sessions.id, id)).limit(1);
    return rows[0] ? sessionRowToDomain(rows[0]) : null;
  }

  async list(): Promise<AgentSession[]> {
    const rows = await this.d.select().from(t.sessions);
    return rows.map(sessionRowToDomain).sort((a, b) => b.lastHeartbeatAt.localeCompare(a.lastHeartbeatAt));
  }
}

/* ---------------- artifacts ---------------- */

function artifactRowToDomain(r: typeof t.artifacts.$inferSelect): Artifact {
  return {
    id: r.id,
    type: r.type as Artifact["type"],
    path: r.path,
    title: r.title,
    tags: fromJson<string>(r.tags),
    owner: r.owner,
    status: r.status,
    expiresAt: r.expiresAt,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export class ArtifactsRepo {
  constructor(private d: LibSQLDatabase<Schema>) {}

  async upsert(a: Artifact): Promise<void> {
    await this.d
      .insert(t.artifacts)
      .values({
        id: a.id,
        type: a.type,
        path: a.path,
        title: a.title,
        tags: toJson(a.tags),
        owner: a.owner,
        status: a.status,
        expiresAt: a.expiresAt,
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
      })
      .onConflictDoUpdate({
        target: t.artifacts.path,
        set: {
          title: a.title,
          tags: toJson(a.tags),
          owner: a.owner,
          status: a.status,
          expiresAt: a.expiresAt,
          updatedAt: a.updatedAt,
        },
      });
  }

  async get(id: string): Promise<Artifact | null> {
    const rows = await this.d.select().from(t.artifacts).where(eq(t.artifacts.id, id)).limit(1);
    return rows[0] ? artifactRowToDomain(rows[0]) : null;
  }

  async getByPath(path: string): Promise<Artifact | null> {
    const rows = await this.d.select().from(t.artifacts).where(eq(t.artifacts.path, path)).limit(1);
    return rows[0] ? artifactRowToDomain(rows[0]) : null;
  }

  async list(f: { type?: Artifact["type"]; status?: string } = {}): Promise<Artifact[]> {
    const conds = [];
    if (f.type) conds.push(eq(t.artifacts.type, f.type));
    if (f.status) conds.push(eq(t.artifacts.status, f.status));
    const q = this.d.select().from(t.artifacts);
    const rows = conds.length === 1 ? await q.where(conds[0]) : conds.length > 1 ? await q.where(and(...conds)) : await q;
    return rows.map(artifactRowToDomain);
  }
}

/* ---------------- events (outbox) ---------------- */

export class EventsRepo {
  constructor(private d: LibSQLDatabase<Schema>) {}

  async append(e: Event): Promise<void> {
    await this.d.insert(t.events).values({
      id: e.id,
      type: e.type,
      payload: JSON.stringify(e.payload ?? {}),
      actorType: e.actorType,
      actorId: e.actorId,
      createdAt: e.createdAt,
      consumedAt: e.consumedAt,
    });
  }

  async pending(limit = 100): Promise<Event[]> {
    const rows = await this.d
      .select()
      .from(t.events)
      .where(isNull(t.events.consumedAt))
      .orderBy(t.events.createdAt)
      .limit(limit);
    return rows.map((r) => ({
      id: r.id,
      type: r.type as Event["type"],
      payload: JSON.parse(r.payload),
      actorType: r.actorType as Event["actorType"],
      actorId: r.actorId,
      createdAt: r.createdAt,
      consumedAt: r.consumedAt,
    }));
  }

  async markConsumed(ids: string[], at: string): Promise<void> {
    if (ids.length === 0) return;
    await this.d
      .update(t.events)
      .set({ consumedAt: at })
      .where(sql`${t.events.id} IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`);
  }

  async listByType(type: string, limit = 200): Promise<Event[]> {
    const rows = await this.d
      .select()
      .from(t.events)
      .where(eq(t.events.type, type))
      .orderBy(desc(t.events.createdAt))
      .limit(limit);
    return rows.map((r) => ({
      id: r.id,
      type: r.type as Event["type"],
      payload: JSON.parse(r.payload),
      actorType: r.actorType as Event["actorType"],
      actorId: r.actorId,
      createdAt: r.createdAt,
      consumedAt: r.consumedAt,
    }));
  }
}
