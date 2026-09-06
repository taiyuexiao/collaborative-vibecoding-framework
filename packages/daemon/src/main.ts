#!/usr/bin/env node
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { adapterByName } from "./adapters.js";
import { DaemonClient } from "./client.js";
import { TaskExecutor } from "./executor.js";
import { createLogger } from "@superteam/infra";

interface Args {
  server: string;
  token: string;
  repo: string;
  adapter: string;
  interval: string;
  once: boolean;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (k: string) => {
    const i = argv.indexOf(`--${k}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const args: Args = {
    server: get("server") ?? process.env["SUPERTEAM_SERVER"] ?? "http://127.0.0.1:7300",
    token: get("token") ?? process.env["SUPERTEAM_TOKEN"] ?? "",
    repo: resolve(get("repo") ?? process.cwd()),
    adapter: get("adapter") ?? "claude-code",
    interval: get("interval") ?? "5000",
    once: argv.includes("--once"),
  };
  if (!args.token) {
    console.error("用法：superteam-daemon --server <url> --token <成员token> --repo <仓库路径> [--adapter echo|claude-code] [--once]");
    process.exit(1);
  }
  return args;
}

async function main() {
  const a = parseArgs();
  const log = createLogger("daemon");
  mkdirSync(join(a.repo, ".superteam-worktrees"), { recursive: true });

  const client = new DaemonClient(a.server, a.token);
  const executor = new TaskExecutor({
    client,
    adapter: adapterByName(a.adapter),
    repoDir: a.repo,
    worktreeRoot: join(a.repo, ".superteam-worktrees"),
    logger: log,
  });

  if (a.once) {
    const r = await executor.tick();
    console.log(JSON.stringify(r));
    return;
  }
  log.info(`daemon 启动：server=${a.server} repo=${a.repo} adapter=${a.adapter}`);
  await executor.ensureSession();
  executor.runLoop(Number(a.interval));
}

main().catch((err) => {
  console.error("[superteam-daemon] fatal:", err);
  process.exit(1);
});
