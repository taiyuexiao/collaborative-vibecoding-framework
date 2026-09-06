# SDD: server 装配（Fastify 应用 + REST 路由 + WS 广播）

## 任务描述

把 data/knowledge/tasks 服务装配成 HTTP 服务：成员与 token 认证、任务/档案/会话/事件路由、AppError→HTTP 错误映射、WS 事件广播。对应 TECH §9。S3.4 的 sessions 路由在此一并实现。

## 目标与验收

- [x] `createContext(config)`：装配 db/repos/git/search/knowledge/taskService（测试与 main 共用）
- [x] `buildServer(ctx)`：注册全部路由 + CORS + WS；错误统一 `{error:{code,message,details}}`；未知错误 500 不泄内部信息
- [x] 认证：`Authorization: Bearer <token>`，sha256 比对 tokenHash；写操作必须认证；POST /members 免认证（bootstrap）
- [x] WS `/ws`：task.transitioned / task.created / task.dep_changed / session.status 广播给所有连接
- [x] 集成测试（fastify inject）：bootstrap→认证→建任务→迁移→依赖环 409→propose→检索→会话注册/心跳→未认证 401

## 技术路线

Fastify v5 + @fastify/cors + @fastify/websocket。路由处理函数保持薄：解析参数 → 调服务 → 序列化。broadcast 通过闭包注入路由。

## 原理

会话心跳接口是 daemon（S3.1-S3.3）与服务端的唯一通道：register 建会话，heartbeat 带状态/分支/diff 摘要更新。看板轮询或 WS 消费同一数据。

## 输入 / 输出

- 输入：S0.3/S0.5/S1.2/S1.3/S2.x 服务
- 输出：REST API + WS；daemon 与 web 消费

## 上下游依赖

- 上游：全部服务包
- 下游：S2.4 web、S3.x daemon、S6.3 冒烟

## 接口签名

```ts
export interface Context { config; db; members: MembersRepo; tasks: TasksRepo; deps: DepsRepo;
  events: EventsRepo; artifacts: ArtifactsRepo; sessions: SessionsRepo; git: GitProvider;
  search: SearchService; knowledge: KnowledgeRepo; taskService: TaskService }
export function createContext(config: SuperteamConfig): Promise<Context>
export function buildServer(ctx: Context): Promise<FastifyInstance>   // routes + ws + error handler
export function broadcast(ctx, type: string, payload: unknown): void  // 测试可注入
```

## 测试清单

- `app.test.ts`：成员 bootstrap（返回明文 token 一次）；401；任务 CRUD/transition/依赖环；propose+search；session register/heartbeat/列表；WS 广播冒烟（inject 无法测 WS，改在 S6.3 冒烟覆盖）

## 报错与解决

（滚动追加）

## 实际偏差

无。

## 报错与解决

1. **报错**：集成测试建库报 `Unable to open connection to local database ...: 14`（SQLITE_CANTOPEN）——data 目录不存在。与 S1.2 的 git init 教训同源。
   **解决**：createContext 里 `mkdirSync(dataDir, {recursive:true})`，ensure 语义下沉。
2. **报错**：propose 500（ENOENT 写 cards/xxx.md）——server 集成测试未调 ensureScaffold，目录未建。
   **解决**：把 `ctx.knowledge.ensureScaffold()` 上移到 buildServer（应用级不变式，调用方无需记忆）。
3. **报错**：sessions/register 500（SQLITE_CONSTRAINT_FOREIGNKEY）——路由把 `memberId` 写成了成员 name 而非 id。
   **解决**：路由改用 `authMember` 返回的完整 Member，取 `member.id`；并用最小复现脚本（绕过路由直连服务）把「路由层 bug」与「服务层 bug」分离定位。

## 实际偏差

无。

## 补充（S6.4）：7300 直接托管 Web 界面

用户预期「工作入口只有一个」——server 现在用 @fastify/static 托管 packages/web/dist，SPA fallback 对非 /api、/ws 路径回 index.html。构建产物不存在时自动跳过（纯 API 模式仍可用）。dev 实例数据目录（/data/、/knowledge/）加入 .gitignore。

## 补充（E2E 全功能扫描结论）

scripts/e2e-full.ts 对真实 main.ts 实例做 12 组 43 项全功能扫描（静态托管/认证/生命周期/依赖/知识/会话/WS/daemon/雷达循环/蒸馏循环/MCP stdio/日报/并发与畸形输入轰炸），全部通过。过程中修复两个装配层真 bug：
1. main.ts 雷达循环的状态过滤漏 waiting_review（与 radar.ts 重复维护所致）——装配层与领域层共享的常量应单点定义；
2. 畸形 JSON 返回 500——error handler 现在尊重 Fastify 框架错误的 statusCode（4xx 透传）。
另修复 infra config 的 env 映射漏配（SUPERTEAM_REPO_DIR/FEISHU_WEBHOOK 在 schema 有字段但 loadConfig 未读取，静默失效）——新增回归测试钉死。
