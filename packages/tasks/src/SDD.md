# SDD: S2.1-S2.3 任务服务（CRUD / 状态机迁移 / 依赖图）

## 任务描述

任务总线的领域服务层：任务创建（DoD 必填）、状态迁移（core 纯函数 + 持久化 + 事件 outbox）、依赖边管理（存在性校验 + 环检测 + 变更事件）。对应 PRD F1.1-F1.3。HTTP 路由在 server 包（S2.4/装配）。

## 目标与验收

- [x] `create`：title/dod 必填（zod），初始 status=draft，发布 `task.created`
- [x] `transition`：结构合法性由 core.transition 保证；持久化新状态；发布 `task.transitioned`（含 from/to/action）
- [x] 非法迁移：抛 ILLEGAL_TRANSITION 且**不落库、不发事件**
- [x] `setDeps`：两端任务必须存在（NOT_FOUND）；新增边成环抛 CYCLIC_DEPEND（DFS 检测）；成功后发布 `task.dep_changed`
- [x] `downstreamOf(id)`：返回依赖 id 的任务清单（雷达 S4.2 契约变更通知用）
- [x] 单元测试：真实 sqlite 覆盖上述全部路径

## 技术路线

服务层只编排：校验（zod）→ core 纯函数 → data 仓储 → outbox 事件。环检测在服务层做（core 保持零持久依赖）。

## 原理

```
setDeps(taskId, newEdges):
  all = existing(all) + newEdges          # 合并后检测
  graph: Map<taskId, dependsOnTaskId[]>
  dfs(taskId, target=taskId)：沿 dependsOn 边下探，回到起点即成环
```

## 输入 / 输出

- 输入：core（Task/transition/AppError）、data（TasksRepo/DepsRepo/EventsRepo）
- 输出：`TaskService`；server 路由消费；S4.2 消费 downstreamOf 与 dep_changed 事件

## 上下游依赖

- 上游：S0.2、S0.3
- 下游：server（S2.x 路由 + WS 广播）、S3.3 daemon、S4.2 雷达、S5.1 蒸馏器

## 接口签名

```ts
export interface CreateTaskInput { title, description?, dod, module?, tags?, assigneeMemberId? }
export class TaskService {
  constructor(deps: { tasks: TasksRepo; deps: DepsRepo; events: EventsRepo })
  create(input: CreateTaskInput, actor: Actor): Promise<Task>
  get(id: string): Promise<Task>                              // NOT_FOUND
  list(f?: { status?, module?, assigneeMemberId? }): Promise<Task[]>
  transition(id: string, action: TaskAction, actor: Actor): Promise<Task>
  setDeps(id: string, edges: { dependsOnTaskId: string; kind?: "interface"|"sequence" }[], actor: Actor): Promise<TaskDep[]>
  getDeps(id: string): Promise<TaskDep[]>
  downstreamOf(id: string): Promise<Task[]>
}
```

## 测试清单

- `task-service.test.ts`：create 校验与事件；transition 主路径+事件内容；非法迁移不落库；setDeps 存在性校验/环检测/幂等覆盖/downstreamOf

## 报错与解决

（滚动追加）

## 实际偏差

无。

## 报错与解决

1. **报错（测试发现真 bug）**：环检测首版只建「当前任务」的局部图——b→c 已存在时新增 c→b 检不出环（promise 未 reject）。
   **解决**：改为全库边建图（他人任务边 + 本任务新边）。教训：环检测的视野必须是全图。
2. **报错（测试纠正语义）**：setDeps 首版把全库边合并写回，导致覆盖写后旧边残留（getDeps 返回 2 条）。
   **解决**：明确 setDeps 为 PUT 语义——整体替换本任务依赖集合；他人任务边不动。测试随之改为断言替换语义。

## 实际偏差

无。
