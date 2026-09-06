# SDD: S0.2 领域模型（core 包）

## 任务描述

定义全系统共享的领域模型：六类实体的 zod schema 与 TS 类型、任务状态机（纯函数）、统一业务错误。对应 PRD F1.2（状态机流转）与 TECH §3。

## 目标与验收

- [x] 六实体 schema：Member / AgentSession / Task / TaskDep / Artifact / Event，类型由 z.infer 推导，不手写重复类型
- [x] 任务状态机为纯函数 `transition(task, action)`，合法迁移可穷举，非法迁移抛 `AppError(ILLEGAL_TRANSITION)`
- [x] `block` 记录来源状态，`resume` 精确返回来源状态
- [x] 零依赖（除 zod）：core 不 import 任何其他 @superteam 包
- [x] 单元测试覆盖：全部合法迁移路径 + 全部非法迁移 + block/resume 往返 + cancel 边界

## 技术路线

zod v3（成熟稳定）：schema 即文档，类型推导避免两份定义。状态机用「迁移表」而非 if/else：`Record<status, Partial<Record<action, target>>>`，可测试、可序列化、可被前端复用做按钮显隐。

## 原理

```
迁移表 TRANSITIONS[status][action] = nextStatus | 'SELF'（block 特例）
transition(task, action):
  next = TRANSITIONS[task.status]?.[action]
  无 → AppError ILLEGAL_TRANSITION（携带 from/action）
  action=block → { ...task, status:'blocked', blockedFrom: task.status }
  action=resume → { ...task, status: task.blockedFrom ?? 'draft', blockedFrom: undefined }
  其余 → { ...task, status: next }
```

授权（谁能执行哪个 action）不在 core：由服务层按 actor 校验，core 只管结构合法性。

## 输入 / 输出

- 输入：TECH.md §3 领域模型设计
- 输出：`@superteam/core` 导出的 schemas/types/transition/AppError；被 data（建表）、tasks（服务）、server（API 校验）、web（表单）消费

## 上下游依赖

- 上游：S0.1（脚手架）
- 下游：S0.3 data、S2.1/S2.2 tasks、S3.x daemon、S2.4 web

## 接口签名

```ts
// entities.ts
export const MemberSchema / AgentSessionSchema / TaskSchema / TaskDepSchema /
  ArtifactSchema / EventSchema: z.ZodObject
export type Member / AgentSession / Task / TaskDep / Artifact / Event  // z.infer
export const TASK_STATUSES / TASK_ACTIONS / ARTIFACT_TYPES / EVENT_TYPES: readonly string[]
export type TaskStatus / TaskAction / ArtifactType / EventType

// state-machine.ts
export const TRANSITIONS: Record<TaskStatus, Partial<Record<TaskAction, TaskStatus>>>
export function transition(task: Task, action: TaskAction): Task
export function allowedActions(status: TaskStatus): TaskAction[]

// errors.ts
export const ERROR_CODES = ['ILLEGAL_TRANSITION','CYCLIC_DEPEND','VALIDATION_FAILED',
  'NOT_FOUND','UNAUTHORIZED','CONFLICT'] as const
export class AppError extends Error { code; details?; constructor(code, message, details?) }

// ids.ts
export function newId(prefix: string): string   // prefix_时间基36_随机基36
```

## 测试清单

- `state-machine.test.ts`：主路径 draft→…→done；requestChanges 返工；block/resume 从四个状态往返；cancel 各状态；终态拒绝全部 action；allowedActions 完整性
- `entities.test.ts`：TaskSchema 拒绝空 title/空 dod；ArtifactSchema 校验 type 枚举与 expires 日期格式；EventSchema payload 宽松

## 报错与解决

1. **报错**：`verbatimModuleSyntax` 开启后 `import { z } from "zod"` 之外，纯类型导入必须 `import type`，否则 vitest 报 `[vitest] No "TaskStatus" export is defined on the "exports" entry`（esbuild 按 ESM 严格处理类型擦除）。
   **解决**：跨文件类型一律 `import type { ... }`；值导入保持普通 import。

2. **报错（测试发现的设计缺陷）**：首版状态机 `blocked` 只允许 `resume`，单测「cancel 各状态」在 blocked 上失败——被阻塞的任务将永久卡死，无法放弃。
   **解决**：迁移表 `blocked` 增加 `cancel: "canceled"`；同步修正 allowedActions 断言为 `["resume","cancel"]`。这正是先写规格测试再实现要抓的问题。

## 实际偏差

- TECH.md 将「统一错误」归在 infra；实际下沉到 core（状态机需抛 AppError，core 不得反向依赖 infra），由 infra re-export。已同步 TECH 观感不改动，以本 SDD 为准。
