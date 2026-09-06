import type { FastifyInstance } from "fastify";
import type { ArtifactType } from "@superteam/core";
import { AppError } from "@superteam/core";
import { authMember, requireActor } from "./app.js";
import { hashToken, newToken } from "./context.js";
import type { Context } from "./context.js";

export type Broadcast = (type: string, payload: unknown) => void;

export function buildRoutes(ctx: Context, broadcast: Broadcast) {
  return async function routes(app: FastifyInstance) {
    /* ---------------- members ---------------- */

    app.post("/api/v1/members", async (req) => {
      const body = (req.body ?? {}) as { name?: string; role?: string };
      const name = body.name?.trim();
      if (!name) throw new AppError("VALIDATION_FAILED", "name 必填");
      if (await ctx.members.getByName(name)) {
        throw new AppError("CONFLICT", `成员已存在：${name}`);
      }
      const token = newToken();
      const member = {
        id: `mem_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        name,
        role: (body.role === "lead" ? "lead" : "member") as "lead" | "member",
        tokenHash: hashToken(token),
        createdAt: new Date().toISOString(),
      };
      await ctx.members.insert(member);
      // token 明文只在创建时返回一次
      return { member: { ...member, tokenHash: undefined }, token };
    });

    app.get("/api/v1/members", async () => {
      const list = await ctx.members.list();
      return list.map((m) => ({ ...m, tokenHash: undefined }));
    });

    /* ---------------- tasks ---------------- */

    app.post("/api/v1/tasks", async (req) => {
      const m = requireActor(await authMember(ctx, req));
      const task = await ctx.taskService.create((req.body ?? {}) as never, m);
      broadcast("task.created", { taskId: task.id, title: task.title });
      return task;
    });

    app.get("/api/v1/tasks", async (req) => {
      const q = req.query as { status?: string; module?: string; assignee?: string; tag?: string };
      const list = await ctx.taskService.list({
        status: q.status as never,
        module: q.module,
        assigneeMemberId: q.assignee,
      });
      const filtered = q.tag ? list.filter((t) => t.tags.includes(q.tag!)) : list;
      return filtered;
    });

    app.get("/api/v1/tasks/:id", async (req) => {
      const { id } = req.params as { id: string };
      const task = await ctx.taskService.get(id);
      return { ...task, deps: await ctx.taskService.getDeps(id) };
    });

    app.post("/api/v1/tasks/:id/transition", async (req) => {
      const m = requireActor(await authMember(ctx, req));
      const { id } = req.params as { id: string };
      const body = (req.body ?? {}) as { action?: string };
      const task = await ctx.taskService.transition(id, body.action as never, m);
      broadcast("task.transitioned", { taskId: id, to: task.status, actor: m.actorId });
      return task;
    });

    app.put("/api/v1/tasks/:id/deps", async (req) => {
      const m = requireActor(await authMember(ctx, req));
      const { id } = req.params as { id: string };
      const body = (req.body ?? {}) as { deps?: { dependsOnTaskId: string; kind?: string }[] };
      const deps = await ctx.taskService.setDeps(id, body.deps ?? [], m);
      broadcast("task.dep_changed", { taskId: id });
      return deps;
    });

    /* ---------------- artifacts (knowledge) ---------------- */

    app.post("/api/v1/artifacts/propose", async (req) => {
      const m = requireActor(await authMember(ctx, req));
      const b = (req.body ?? {}) as Record<string, unknown>;
      const r = await ctx.knowledge.propose({
        type: b["type"] as ArtifactType,
        title: b["title"] as string,
        body: b["body"] as string,
        tags: b["tags"] as string[] | undefined,
        owner: (b["owner"] as string) ?? m.actorId,
        status: b["status"] as string | undefined,
        expires: b["expires"] as string | undefined,
        actor: { actorType: "human", actorId: m.actorId },
      });
      broadcast("artifact.proposed", { path: r.path });
      return r;
    });

    app.get("/api/v1/artifacts", async (req) => {
      const q = req.query as { text?: string; type?: ArtifactType; tags?: string; limit?: string };
      const tags = q.tags ? q.tags.split(",").map((t) => t.trim()).filter(Boolean) : undefined;
      return ctx.search.query({
        text: q.text,
        type: q.type,
        tags,
        limit: q.limit ? Number(q.limit) : undefined,
      });
    });

    app.get("/api/v1/artifacts/history", async () => {
      return ctx.knowledge.recentChanges(20);
    });

    app.get("/api/v1/artifacts/*", async (req, reply) => {
      const path = (req.params as Record<string, string>)["*"];
      if (!path || !path.endsWith(".md")) {
        throw new AppError("NOT_FOUND", "仅支持 .md 知识文件");
      }
      if ((req.query as { history?: string }).history) {
        return ctx.knowledge.history(path);
      }
      const { parsed } = await ctx.knowledge.read(path);
      const { renderKnowledge } = await import("@superteam/knowledge");
      return renderKnowledge(parsed);
    });

    /* ---------------- sessions (daemon) ---------------- */

    app.post("/api/v1/sessions/register", async (req) => {
      const member = await authMember(ctx, req);
      requireActor(member);
      const b = (req.body ?? {}) as { adapter?: string; sessionId?: string };
      const session = {
        id: b.sessionId ?? `sess_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        memberId: member!.id,
        adapter: (b.adapter ?? "claude-code") as never,
        taskId: null,
        branch: null,
        status: "idle" as never,
        diffSummary: null,
        lastHeartbeatAt: new Date().toISOString(),
      };
      await ctx.sessions.upsert(session);
      broadcast("session.status", { sessionId: session.id, status: "idle" });
      return session;
    });

    app.post("/api/v1/sessions/:id/heartbeat", async (req) => {
      const m = requireActor(await authMember(ctx, req));
      void m;
      const { id } = req.params as { id: string };
      const current = await ctx.sessions.get(id);
      if (!current) throw new AppError("NOT_FOUND", `会话不存在：${id}`);
      const b = (req.body ?? {}) as Partial<{
        status: string;
        taskId: string | null;
        branch: string | null;
        diffSummary: string | null;
      }>;
      const updated = {
        ...current,
        status: (b.status ?? current.status) as never,
        taskId: b.taskId !== undefined ? b.taskId : current.taskId,
        branch: b.branch !== undefined ? b.branch : current.branch,
        diffSummary: b.diffSummary !== undefined ? b.diffSummary : current.diffSummary,
        lastHeartbeatAt: new Date().toISOString(),
      };
      await ctx.sessions.upsert(updated);
      broadcast("session.status", { sessionId: id, status: updated.status, taskId: updated.taskId });
      return updated;
    });

    app.get("/api/v1/sessions", async () => ctx.sessions.list());

    /* ---------------- digest / notify ---------------- */

    app.get("/api/v1/digest", async (req) => {
      const q = req.query as { hours?: string };
      return { markdown: await ctx.digest.generate(q.hours ? Number(q.hours) : 24) };
    });

    app.post("/api/v1/digest/send", async (req) => {
      requireActor(await authMember(ctx, req));
      const markdown = await ctx.digest.generate(24);
      await ctx.notify.sendText(markdown);
      broadcast("notify.sent", { channel: ctx.notify.name });
      return { sent: true, channel: ctx.notify.name };
    });

    /* ---------------- events ---------------- */

    app.get("/api/v1/events", async (req) => {
      const q = req.query as { type?: string; limit?: string };
      return ctx.events.listByType(q.type ?? "task.transitioned", q.limit ? Number(q.limit) : 100);
    });
  };
}
