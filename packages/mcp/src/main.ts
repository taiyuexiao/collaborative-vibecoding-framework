#!/usr/bin/env node
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { join } from "node:path";
import { createDb, ArtifactsRepo, EventsRepo } from "@superteam/data";
import { LocalGitProvider } from "@superteam/gitprov";
import { createLogger, loadConfig } from "@superteam/infra";
import { KnowledgeRepo } from "@superteam/knowledge";
import { SearchService } from "@superteam/knowledge";
import { buildKnowledgeHandlers } from "./handlers.js";

export async function startMcpServer(): Promise<void> {
  const cfg = loadConfig();
  const log = createLogger("mcp", cfg.logLevel);
  const db = await createDb(join(cfg.dataDir, "superteam.db"));
  const git = new LocalGitProvider();
  const search = new SearchService(db.client);
  const repo = new KnowledgeRepo({
    knowledgeDir: cfg.knowledgeDir,
    git,
    artifacts: new ArtifactsRepo(db.db),
    events: new EventsRepo(db.db),
    indexer: search,
    logger: log,
  });
  const handlers = buildKnowledgeHandlers({ repo, search });

  const server = new McpServer({ name: "superteam-knowledge", version: "0.1.0" });

  server.registerTool(
    "search",
    {
      description: "全文检索团队知识库（支持中文短语、类型 spec/adr/card/reading/agent-doc、标签过滤）",
      inputSchema: {
        text: z.string().optional(),
        type: z.enum(["spec", "adr", "card", "reading", "agent-doc"]).optional(),
        tags: z.array(z.string()).optional(),
        limit: z.number().int().min(1).max(50).optional(),
      },
    },
    async (args) => ({
      content: [{ type: "text", text: JSON.stringify(await handlers.search(args), null, 2) }],
    }),
  );

  server.registerTool(
    "read",
    {
      description: "按路径读取一篇知识文档（返回 front-matter 元数据与正文，超长截断）",
      inputSchema: { path: z.string().min(1) },
    },
    async (args) => ({
      content: [{ type: "text", text: JSON.stringify(await handlers.read(args), null, 2) }],
    }),
  );

  server.registerTool(
    "propose",
    {
      description: "向团队知识库写入一篇知识文档（落盘+git 提交，可审计）",
      inputSchema: {
        type: z.enum(["spec", "adr", "card", "reading", "agent-doc"]),
        title: z.string().min(1),
        body: z.string().min(1),
        tags: z.array(z.string()).optional(),
        owner: z.string().optional(),
        status: z.string().optional(),
        expires: z.string().optional(),
        actorId: z.string().optional(),
      },
    },
    async (args) => ({
      content: [{ type: "text", text: JSON.stringify(await handlers.propose(args), null, 2) }],
    }),
  );

  server.registerTool(
    "latest",
    {
      description: "知识库最近变更（git 提交视角，含每篇标题）",
      inputSchema: { n: z.number().int().min(1).max(50).optional() },
    },
    async (args) => ({
      content: [{ type: "text", text: JSON.stringify(await handlers.latest(args), null, 2) }],
    }),
  );

  await server.connect(new StdioServerTransport());
  log.info("superteam MCP server started on stdio");
}

startMcpServer().catch((err) => {
  console.error("[superteam-mcp] fatal:", err);
  process.exit(1);
});
