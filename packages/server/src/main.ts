#!/usr/bin/env node
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createContext } from "./context.js";
import { buildServer } from "./app.js";
import { createLogger, loadConfig } from "@superteam/infra";
import { ConflictRadar } from "@superteam/radar";
import { EventConsumer, taskDoneCardRule } from "@superteam/distiller";

async function main() {
  const cfg = loadConfig();
  const log = createLogger("server", cfg.logLevel);
  mkdirSync(cfg.dataDir, { recursive: true });

  const ctx = await createContext(cfg);
  await ctx.knowledge.ensureScaffold();

  const app = await buildServer(ctx);
  await app.listen({ port: cfg.port, host: cfg.host });
  log.info(`superteam server listening on http://${cfg.host}:${cfg.port}`);

  // 蒸馏循环：消费 outbox（任务 done → 经验卡）
  const consumer = new EventConsumer(ctx.events, log);
  const distillTimer = setInterval(() => {
    void consumer.consumeOnce([taskDoneCardRule({ knowledge: ctx.knowledge, llm: ctx.llm })]);
  }, 5000);
  distillTimer.unref();

  // 冲突雷达循环：扫描本机 worktree（远端成员的分支由其本机 radar 上报，后续扩展）
  const radar = new ConflictRadar({ git: ctx.git, tasks: ctx.tasks, deps: ctx.deps, events: ctx.events });
  const radarTimer = setInterval(() => {
    void (async () => {
      const inFlight = await ctx.tasks.list();
      // 与 radar.ts 的 IN_FLIGHT_STATUSES 保持一致：waiting_review（待评审未合入）也是冲突高危窗口
      const items = inFlight
        .filter((t) => ["claimed", "coding", "self_review", "waiting_review"].includes(t.status))
        .map((t) => ({ taskId: t.id, dir: join(cfg.repoDir, ".superteam-worktrees", t.id) }))
        .filter((i) => existsSync(i.dir));
      if (items.length > 0) await radar.sweep(items);
    })().catch((err) => log.error({ err }, "radar sweep 失败"));
  }, cfg.radarIntervalMs);
  radarTimer.unref();
}

main().catch((err) => {
  console.error("[superteam-server] fatal:", err);
  process.exit(1);
});
