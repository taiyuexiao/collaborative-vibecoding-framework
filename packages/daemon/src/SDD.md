# SDD: S3.1-S3.3 会话桥 daemon（骨架 / AgentAdapter / 任务执行器）

## 任务描述

装在成员机器上的常驻进程：向 server 注册会话并心跳；认领任务 → 创建隔离 worktree → 组装上下文 prompt（任务+DoD+AGENTS.md）→ 驱动本地 coding agent → 收集 diff → 状态回写。对应 PRD F4.1-F4.4。

## 目标与验收

- [x] AgentAdapter 接口 + 两个实现：echo（写文件模拟，全链路可测）/ claude-code（`claude -p` headless）
- [x] TaskExecutor.tick()：认领最旧的 draft 任务 → worktree（`task/<id>` 分支）→ prompt → run → commitAll → changedFiles 统计 → submit（waiting_review）；失败 → block + 心跳上报
- [x] prompt 组装：任务三要素 + `agents/AGENTS.md`（存在则注入）
- [x] DaemonClient：register/heartbeat/transition/listTasks 的 HTTP 封装
- [x] main.ts CLI：`--server --token --repo --adapter --once`（once 供测试与冒烟）
- [x] 集成测试：真实 server（listen port 0）+ 临时 git 仓库 + echo adapter，跑完 tick 后任务到达 waiting_review、分支有提交、会话状态同步

## 技术路线

daemon 不依赖 server 包代码，只走 REST——部署解耦。WS 客户端不做（daemon 是拉模式：心跳+轮询领任务），SDD 记为偏差。

## 原理

「一任务一 worktree 一分支」：gitprov.ensureWorktree 保证幂等；agent 在 workdir 内自由改文件，daemon 收口提交；diffSummary 用 changedFiles(merge-base) 生成，**只上报统计与文件名清单，不上传内容**（隐私边界）。

## 输入 / 输出

- 输入：core（Task/allowedActions）、gitprov、infra（config/logger）
- 输出：daemon CLI；被 S4.1 雷达消费其上报的分支/diff、S6.3 冒烟使用 echo adapter

## 上下游依赖

- 上游：S0.2/S0.5、server REST（S2.x/S3.4）
- 下游：S4.1 雷达、看板会话面板

## 接口签名

```ts
export interface AgentRunInput { prompt: string; workdir: string }
export interface AgentRunResult { exitCode: number; output: string }
export interface AgentAdapter {
  name: string
  available(): Promise<boolean>
  run(input: AgentRunInput): Promise<AgentRunResult>
}
export class EchoAdapter implements AgentAdapter      // 写 echo-output.md
export class ClaudeCodeAdapter implements AgentAdapter // spawn claude -p
export function buildPrompt(task, agentsDoc?: string): string

export class DaemonClient {
  constructor(serverUrl: string, token: string)
  register(adapter): Promise<Session>; heartbeat(id, patch): Promise<Session>
  listTasks(): Promise<Task[]>; transition(id, action): Promise<Task>
}
export class TaskExecutor {
  constructor(deps: { client: DaemonClient; adapter: AgentAdapter; repoDir: string; worktreeRoot: string; logger })
  tick(): Promise<{ claimed: boolean; taskId?: string }>   // once 语义
  runLoop(intervalMs): void
}
```

## 测试清单

- `prompt.test.ts`：buildPrompt 含 title/dod/AGENTS.md；无 AGENTS.md 时不注入
- `executor.integration.test.ts`：echo 全链路（认领→分支提交→waiting_review→心跳 diffSummary）；无任务时 tick 空转；adapter 失败 → blocked

## 报错与解决

（滚动追加）

## 实际偏差

- TECH §7 的 WS 长连接降级为 HTTP 心跳轮询（daemon 侧无需服务端推送；减少一条长连接管理复杂度）。
- S3.4「服务端 sessions 模块」已随 server 包（S2.x）交付，此处不重复。

## 报错与解决

1. **报错（状态机正确拦截执行器）**：tick 快乐路径 blocked——执行器在 `claimed` 状态直接调 `submit`（ILLEGAL_TRANSITION），catch 兜底转了 blocked。
   **解决**：执行流程补 `claim → start → … → submit`。这正是共享状态机的价值：daemon 不可能带病提交评审。
2. **报错**：tick 报 `git merge-base 失败：Not a valid object name main`——测试仓库无文件，`commitAll("init")` 判定无改动未提交，仓库零提交导致 main unborn。
   **解决**：ensureRepo 增加「HEAD 不存在则补空提交」的 ensure 语义（真实仓库总有提交，不受影响）。

## 实际偏差

无（WS 降级见上）。
3. **报错（类型门禁）**：executor 从 client.js 导入 AgentAdapter，但接口定义在 adapters.js。
   **解决**：改为从 adapters.js 导入类型。vitest（esbuild，无类型检查）能跑过而 tsc 拦下——最终验收以 `tsc --noEmit` 全绿 + vitest 全绿双门禁为准。
