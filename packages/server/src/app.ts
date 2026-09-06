import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { AppError, type Actor, type Member } from "@superteam/core";
import { statusForError } from "@superteam/infra";
import { hashToken } from "./context.js";
import { buildRoutes } from "./routes.js";
import type { Context } from "./context.js";

export async function buildServer(ctx: Context): Promise<FastifyInstance> {
  await ctx.knowledge.ensureScaffold(); // 应用级不变式：知识仓库五目录 + git 就绪

  const app = Fastify({ logger: false });
  await app.register(cors, { origin: true });
  await app.register(websocket);

  // WS 广播：所有连接进同一个房间
  app.get("/ws", { websocket: true }, (conn) => {
    ctx.sockets.add(conn);
    conn.on("close", () => ctx.sockets.delete(conn));
  });

  const broadcast = (type: string, payload: unknown) => {
    const msg = JSON.stringify({ type, payload, at: new Date().toISOString() });
    for (const s of ctx.sockets) {
      try {
        (s as { send: (m: string) => void }).send(msg);
      } catch {
        ctx.sockets.delete(s);
      }
    }
  };
  app.decorate("broadcast", broadcast);

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof AppError) {
      reply.status(statusForError(err)).send({
        error: { code: err.code, message: err.message, details: err.details },
      });
      return;
    }
    reply.status(500).send({ error: { code: "INTERNAL", message: "内部错误" } });
  });

  await app.register(buildRoutes(ctx, broadcast));
  return app;
}

/** 从请求解析认证成员；写路由用它。 */
export async function authMember(ctx: Context, request: FastifyRequest): Promise<Member | null> {
  const header = request.headers["authorization"];
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  const hash = hashToken(token);
  for (const m of await ctx.members.list()) {
    if (m.tokenHash === hash) return m;
  }
  return null;
}

export function requireActor(m: Member | null): Actor {
  if (!m) throw new AppError("UNAUTHORIZED", "需要 Bearer token 认证");
  return { actorType: "human", actorId: m.name };
}
