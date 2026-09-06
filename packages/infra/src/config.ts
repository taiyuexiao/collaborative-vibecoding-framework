import { z } from "zod";
import { AppError } from "@superteam/core";

const ConfigSchema = z.object({
  port: z.coerce.number().int().min(0).max(65535).default(7300), // 0 = 临时端口（测试用）
  host: z.string().default("127.0.0.1"),
  dataDir: z.string().default("./data"),
  knowledgeDir: z.string().default("./knowledge"),
  logLevel: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
  llmBaseUrl: z.string().url().optional(),
  llmApiKey: z.string().min(1).optional(),
  llmModel: z.string().default("glm-4.7"),
  radarIntervalMs: z.coerce.number().int().min(1000).default(30_000),
  repoDir: z.string().default(process.cwd()), // 任务源仓库（雷达扫描 worktree 用）
  feishuWebhook: z.string().url().optional(), // 飞书群机器人 webhook（digest 推送）
});

export type SuperteamConfig = z.infer<typeof ConfigSchema>;

/** 从 env（默认 process.env）加载配置；SUPERTEAM_ 前缀。非法值整体拒绝（VALIDATION_FAILED），避免静默错配。 */
export function loadConfig(env: Record<string, string | undefined> = process.env): SuperteamConfig {
  const raw = {
    port: env["SUPERTEAM_PORT"],
    host: env["SUPERTEAM_HOST"],
    dataDir: env["SUPERTEAM_DATA_DIR"],
    knowledgeDir: env["SUPERTEAM_KNOWLEDGE_DIR"],
    logLevel: env["SUPERTEAM_LOG_LEVEL"],
    llmBaseUrl: env["SUPERTEAM_LLM_BASEURL"],
    llmApiKey: env["SUPERTEAM_LLM_APIKEY"],
    llmModel: env["SUPERTEAM_LLM_MODEL"],
    radarIntervalMs: env["SUPERTEAM_RADAR_INTERVAL_MS"],
  };
  const cleaned = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined));
  const parsed = ConfigSchema.safeParse(cleaned);
  if (!parsed.success) {
    throw new AppError("VALIDATION_FAILED", "配置非法", parsed.error.flatten());
  }
  return parsed.data;
}
