import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
    // Fastify 框架错误（如畸形 JSON 解析失败）自带 statusCode，尊重之；其余未知错误归 500 且不泄内部信息
    const frameworkStatus = (err as { statusCode?: number }).statusCode;
    if (frameworkStatus && frameworkStatus >= 400 && frameworkStatus < 500) {
      reply.status(frameworkStatus).send({ error: { code: "BAD_REQUEST", message: err.message.slice(0, 200) } });
      return;
    }
    reply.status(500).send({ error: { code: "INTERNAL", message: "内部错误" } });
  });

  await app.register(buildRoutes(ctx, broadcast));

  // 托管 web 构建产物：7300 即唯一入口（SPA fallback 不吞 /api 与 /ws 的 404）
  const webDist = join(dirname(fileURLToPath(import.meta.url)), "../../web/dist");
  if (existsSync(join(webDist, "index.html"))) {
    await app.register(fastifyStatic, { root: webDist });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api") || req.url === "/ws") {
        reply.status(404).send({ error: { code: "NOT_FOUND", message: "Not Found" } });
      } else {
        reply.sendFile("index.html");
      }
    });
  }

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
