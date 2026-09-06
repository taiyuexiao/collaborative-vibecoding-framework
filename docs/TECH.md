# 共工（Superteam）技术架构文档（TECH）

| 版本 | 日期 | 作者 | 状态 |
|---|---|---|---|
| v0.1 | 2026-09-06 | spl × ZCode | 初稿（MVP 范围） |

## 1. 技术栈

| 层 | 选型 | 理由 |
|---|---|---|
| 语言 | TypeScript 5.x（Node ≥ 22） | 全栈同语言，类型跨包共享，单人迭代最快 |
| 包管理 | pnpm workspace | monorepo 标配 |
| API 框架 | Fastify | 轻量、schema-first（与 zod 配合）、插件体系 |
| 实时通道 | WebSocket（`@fastify/websocket`） | daemon 心跳/状态上报、看板推送 |
| ORM | Drizzle + better-sqlite3 | 零部署；SQL 透明；FTS5 可用；schema 与 Postgres 方言兼容可迁移 |
| 校验 | zod | API/领域模型/配置统一校验，类型自动推导 |
| CLI | commander | daemon 命令行 |
| Web | Vite + React 18 + react-router | 内部工具够用，避免 Next 的服务端复杂度 |
| 样式 | 手写 CSS（design tokens 变量） | MVP 不引 UI 框架，减少依赖 |
| Markdown | unified/remark + gray-matter | 解析与渲染事实标准 |
| MCP | `@modelcontextprotocol/sdk` | 官方 SDK，stdio 传输 |
| LLM（蒸馏器） | OpenAI 兼容 REST（可配 baseURL） | 可对接 GLM/zcode 网关等 |
| 日志 | pino | 结构化 JSON 日志 |
| 测试 | vitest | 全栈统一，colocated `*.test.ts` |

Node 版本要求：≥ 22（本机 26.8.1）。包管理器 pnpm ≥ 9（本机 12.3.4）。

## 2. Monorepo 结构与包依赖

```
superteam/
├─ docs/                     # PRD / TECH / PLAN / sdd 规范
├─ packages/
│  ├─ core/                  # 领域模型：类型 + zod schema + 状态机（零运行时依赖除 zod）
│  ├─ infra/                 # 配置加载 / pino 日志 / 统一错误（依赖 core）
│  ├─ gitprov/               # GitProvider 接口 + LocalGitProvider（依赖 core, infra）
│  ├─ data/                  # Drizzle schema + migration + 仓储（依赖 core, infra）
│  ├─ knowledge/             # 档案层服务：对象模型/仓库/检索/渲染（依赖 core,data,gitprov,infra）
│  ├─ tasks/                 # 任务总线服务：CRUD/状态机/依赖图（依赖 core,data,infra）
│  ├─ radar/                 # 冲突雷达（依赖 tasks, gitprov）
│  ├─ distiller/             # 蒸馏器（依赖 knowledge, tasks, infra）
│  ├─ mcp/                   # MCP server（依赖 knowledge）
│  ├─ daemon/                # 会话桥 CLI（依赖 core, infra；经 HTTP/WS 调 server）
│  ├─ server/                # Fastify 应用：装配各服务 + 路由 + WS（依赖上述全部服务包）
│  └─ web/                   # React SPA
├─ knowledge/                # 知识仓库数据目录（git 管理，运行时由 server 初始化）
└─ pnpm-workspace.yaml
```

依赖方向单向向下，禁止循环。`core` 不依赖任何其他包。

> 拆包原则：每个产品模块（M1/M2/…）对应独立 package，保证子模块边界清晰、可独立测试；装配发生在 `server`。

## 3. 领域模型（core）

### 3.1 实体

```
Member      { id, name, role: 'lead'|'member', tokenHash, createdAt }
AgentSession{ id, memberId, adapter: 'claude-code'|'zcode'|'echo', taskId?, branch?,
              status: 'idle'|'claimed'|'coding'|'self_review'|'blocked',
              diffSummary?, lastHeartbeatAt }
Task        { id, title, description, dod, module?, tags[], assigneeMemberId?,
              status, createdAt, updatedAt }
TaskDep     { taskId, dependsOnTaskId, kind: 'interface'|'sequence' }
Artifact    { id, type: 'spec'|'adr'|'card'|'reading'|'agent-doc', path,
              title, tags[], owner?, createdAt, updatedAt, expiresAt?, status:
              'draft'|'proposed'|'accepted'|'stale'|'superseded' }
Event       { id, type, payload(json), actorType: 'human'|'agent'|'system',
              actorId, createdAt, consumedAt? }   -- outbox：蒸馏器消费
```

### 3.2 任务状态机

```
draft ──claim──▶ claimed ──start──▶ coding ──selfReview──▶ self_review
  │                  │                 │                        │
  │cancel            │block            │block                   │submit
  ▼                  ▼                 ▼                        ▼
canceled ◀──────── blocked ◀─────────────▶ resume 返回原状态    waiting_review
                                                                         │
                                             approve ┌───────────────────┤ requestChanges
                                                     ▼                   ▼
                                                   done ◀──────── coding（返工）
```

规则：状态迁移函数 `transition(task, action, actor) → { next, event }`，纯函数、可穷举测试；非法迁移抛 `IllegalTransitionError`。

## 4. 数据层（data）

- SQLite 文件：`data/superteam.db`（gitignore）；FTS5 虚表 `artifact_fts`。
- Drizzle schema 即上表实体；`Event.payload` 用 JSON 文本列。
- 迁移：drizzle-kit generate → 运行时 `migrate()`（server 启动时执行）。
- 仓储模式：每实体一个 repository（`list/get/insert/update`），事务用 better-sqlite3 同步事务。

## 5. 知识档案层（knowledge）

### 5.1 目录约定（knowledge/ 即 Git 仓库工作树）

```
knowledge/
├─ specs/      模块文档与接口契约（机器可读优先）
├─ adr/        决策记录（编号递增：adr/0001-xxx.md）
├─ cards/      经验卡（最小知识单元，可带 expires）
├─ readings/   阅读摘录（外部链接+摘要+关联模块）
└─ agents/     AGENTS.md 与 skills（agent 直接消费）
```

### 5.2 front-matter 规范

```yaml
---
title: <string 必填>
type: spec|adr|card|reading|agent-doc   # 必填，须与所在目录一致
tags: [java, idempotency]
owner: <member name>
created: 2026-09-06
expires: 2026-12-06   # 可选，card/reading 可用；到期状态置 stale
status: accepted      # adr: proposed|accepted|superseded；其余默认 accepted
---
```

### 5.3 服务接口（概要）

```
KnowledgeRepo   scan(): Artifact[]            # 全量扫描+校验
                read(path): { frontmatter, body }
                propose(input): { path, commitSha }      # 写入+commit（agent/人共用）
                history(path): CommitInfo[]
SearchService   query({ text?, type?, tags? }): Hit[]      # FTS5 + 过滤
RenderService   render(path): { html, toc, meta }
```

写入权限模型：**propose 一律产生新提交**；MVP 中"人审"体现为 Git 历史可回滚 + 档案站可见作者（agent 写入时 actorType=agent）；MS3 的蒸馏器走 draft→proposed 状态待人确认。

## 6. 任务总线（tasks）

- REST API（见 §9），状态迁移全部走 `transition()` 纯函数。
- 事件：`task.created / task.transitioned / task.dep_changed / task.conflict_alert` 等写入 `events`（outbox），蒸馏器与雷达、看板推送（WS 广播）共用。
- 依赖图：内存构建 + 环检测（DFS）；`kind=interface` 的边表示"上游任务的产出契约被下游引用"。

## 7. 会话桥（daemon）与 agent 适配

```
daemon 进程
 ├─ WSClient（注册/心跳 15s/接收指令）
 ├─ TaskExecutor（领任务 → gitprov.addWorktree → 组 prompt → adapter.run → 收集 diff → 回写）
 └─ AgentAdapter 接口
     { name, available(): boolean,
       run(input: { prompt, workdir, onStdout? }): Promise<{ exitCode, output, sessionId? }> }
```

- **Claude Code adapter**：`claude -p <prompt> --output-format stream-json`（headless 模式）；adapter 只依赖 CLI 存在与退出码，便于 mock 测试。
- prompt 组装模板：任务 title/description/DoD + 关联 spec 全文 + 命中经验卡 top3 + `agents/AGENTS.md`。
- 安全边界：daemon 只上报声明式状态（分支、diff --stat 摘要、状态），不上传文件内容与 agent 思考输出。

## 8. 冲突雷达（radar）与蒸馏器（distiller）

- **radar**：定时（可配，默认 30s）拉取所有在途会话分支的改动文件清单 → 两两求交（同文件）+ 契约目录（specs/agents）变更 → 产出 `task.conflict_alert` 事件 + 更新任务 `conflictWith[]`（看板黄灯）。
- **distiller**：outbox 消费者；规则引擎 = `{ on(eventType), where(payload)?, draft(payload): Promise<ArtifactDraft> }[]`；LLM 起草失败要可降级为模板占位卡片。

## 9. API 约定（server）

Base：`http://127.0.0.1:<port>/api/v1`，JSON；认证 MVP 简化为 `Authorization: Bearer <member token>`（仅 daemon 与写操作需要）。

```
POST   /members                      注册成员（lead）
GET    /members
POST   /tasks                        创建任务（DoD 必填）
GET    /tasks?status=&module=&tag=
GET    /tasks/:id
POST   /tasks/:id/transition         { action, actor }        → 状态机
PUT    /tasks/:id/deps               { deps: [{dependsOnTaskId, kind}] }
GET    /tasks/:id/events
POST   /artifacts/propose            { type, title, body, tags, ... }   → 写入 knowledge
GET    /artifacts?text=&type=&tag=
GET    /artifacts/:path/content      渲染后的 HTML + meta
GET    /artifacts/:path/history
POST   /sessions/register            daemon
POST   /sessions/:id/heartbeat       daemon
GET    /sessions                     看板
WS     /ws                           广播：task.* / session.* / conflict.* 事件
```

错误规范：`{ error: { code, message, details? } }`；HTTP 语义码；业务错误码 `ILLEGAL_TRANSITION / CYCLIC_DEPEND / VALIDATION_FAILED / NOT_FOUND / UNAUTHORIZED`。

## 10. MCP 工具（mcp 包）

| 工具 | 入参 | 出参 |
|---|---|---|
| `search` | `{ text?, type?, tags? }` | 命中列表（path/title/tags/snippet） |
| `read` | `{ path }` | frontmatter + body（截断保护 16k） |
| `propose` | `{ type, title, body, tags, owner? }` | 写入 knowledge + commit sha |
| `latest` | `{ n? }` | 最近 n 条变更（git log 映射） |

## 11. 测试策略

- **单元**：每个子模块 `*.test.ts` colocated；状态机/依赖图/front-matter/检索/重叠分析为分支覆盖重点。
- **集成**：server 用 fastify `inject()`；gitprov 用临时目录真实 git；data 用内存 sqlite（`:memory:` 或 tmpdir）。
- **E2E 冒烟**（M6）：脚本启动 server+web，模拟 daemon（echo adapter）完成"建任务→认领→执行→蒸馏出卡"全链路。
- 命令：`pnpm test`（全量）、`pnpm test --filter <pkg>`。

## 12. SDD 开发规范（每个子模块必挂 SDD.md）

位置：子模块代码目录内，如 `packages/data/src/SDD.md`。

必填章节：

```markdown
# SDD: <S编号 子模块名>
## 任务描述        —— 做什么，为什么存在
## 目标与验收      —— 可验证的完成标准
## 技术路线        —— 选型与理由
## 原理            —— 核心机制说明（图/伪代码）
## 输入 / 输出     —— 上游交付物 / 本模块产出
## 上下游依赖      ——

## 接口签名
## 报错与解决      —— 开发中真实报错 + 解决方法（滚动追加）
## 实际偏差        —— 与计划的差异及原因
```

完成定义（DoD）：代码 + 测试绿 + SDD.md 完整 + `docs/PLAN.md` 勾选。

## 13. 风险与对策

| 风险 | 对策 |
|---|---|
| FTS5 中文分词弱 | 默认 trigram/按字切分的自定义 tokenizer 预处理（写入时生成 `searchable` 列），必要时引入 jieba-wasm |
| Claude Code CLI 行为变更 | adapter 隔离；echo adapter 用于测试兜底 |
| 蒸馏器产出垃圾污染档案 | propose 必人审；过期机制；档案站可见 actor |
| SQLite 并发写 | 单写者模型（better-sqlite3 同步、WAL）；server 单进程 |
