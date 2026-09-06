# SDD: S1.5 MCP server（search / read / propose / latest）

## 任务描述

把知识档案层以 MCP（Model Context Protocol）stdio server 形式暴露给任意 agent（zcode / Claude Code / Codex 等）。对应 PRD F3。

## 目标与验收

- [x] 四个工具：`search(query,filters)` / `read(path)` / `propose(draft)` / `latest(n)`，入参 zod 校验
- [x] 工具处理逻辑与传输解耦：`buildKnowledgeHandlers` 纯逻辑可单测；`main.ts` 只做装配与 stdio 启动
- [x] propose 直接复用 S1.2（写文件+commit+事件），agent 写入天然可审计
- [x] read 截断保护：body > 16k 字符截断并标注
- [x] 单元测试：临时库上走一遍四工具

## 技术路线

官方 `@modelcontextprotocol/sdk`（`McpServer` + `StdioServerTransport`）。工具结果统一 `{ content: [{ type: "text", text: JSON }] }`。

## 原理

agent 在 IDE/CLI 会话内通过 MCP client 调用本 server；stdio 传输由 SDK 管理。依赖注入方向：main 装配 config→db→repos→SearchService→KnowledgeRepo→handlers→server。

## 输入 / 输出

- 输入：S1.2 KnowledgeRepo、S1.3 SearchService、S0.4 loadConfig
- 输出：可执行 MCP server（`pnpm mcp`）与可测试的 handlers；外部消费方为各类 coding agent

## 上下游依赖

- 上游：S1.2、S1.3、S0.3/S0.4
- 下游：用户的 zcode / Claude Code 配置（`.mcp.json` / MCP 设置）

## 接口签名

```ts
export interface KnowledgeHandlers {
  search(args: { text?: string; type?: ArtifactType; tags?: string[]; limit?: number }): Promise<SearchHit[]>
  read(args: { path: string }): Promise<{ path, title, type, tags, owner, status, expiresAt, body, truncated }>
  propose(args: { type, title, body, tags?, owner?, status?, expires?, actorId? }): Promise<{ path, sha }>
  latest(args?: { n?: number }): Promise<{ path, title, date, message }[]>
}
export function buildKnowledgeHandlers(deps): KnowledgeHandlers
// main.ts: startMcpServer() — 装配 + registerTool + StdioServerTransport
```

## 测试清单

- `handlers.test.ts`：propose→search 命中；read 截断；latest 按时间倒序；read 未知路径抛 NOT_FOUND

## 报错与解决

（滚动追加）

## 实际偏差

无。
