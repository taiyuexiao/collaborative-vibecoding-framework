#!/usr/bin/env node
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createContext } from "./context.js";
import { buildServer } from "./app.js";
import { createLogger, loadConfig } from "@superteam/infra";

async function main() {
  const cfg = loadConfig();
  const log = createLogger("server", cfg.logLevel);
  mkdirSync(cfg.dataDir, { recursive: true });

  const ctx = await createContext(cfg);
  await ctx.knowledge.ensureScaffold();

  const app = await buildServer(ctx);
  await app.listen({ port: cfg.port, host: cfg.host });
  log.info(`superteam server listening on http://${cfg.host}:${cfg.port}`);
  log.info(`knowledge dir: ${cfg.knowledgeDir} | data dir: ${join(cfg.dataDir)}`);
}

main().catch((err) => {
  console.error("[superteam-server] fatal:", err);
  process.exit(1);
});
