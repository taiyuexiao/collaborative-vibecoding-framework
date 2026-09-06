# SDD: S4.1-S4.2 冲突雷达（diff 扫描 + 重叠/契约分析）

## 任务描述

扫描在途任务的改动文件集合，检测两类风险：①文件重叠（两任务将合并冲突）；②契约变更（任务改动了 specs//agents/ 下的契约文件，下游任务受影响）。产出告警：双向写 `conflictWith` + `task.conflict_alert` 事件（看板黄灯数据源）。对应 PRD F5.1-F5.2。

## 目标与验收

- [x] `sweep(items)`：items = 在途任务 {taskId, dir}（调用方解析工作区路径，雷达保持无框架依赖）
- [x] 文件重叠：两两求交，非空交集 → 双方 conflictWith 互相加入 + 一条 alert 事件（去重：已记录的 pair 不重复发）
- [x] 契约变更：改动触及契约目录 → 对该任务的每个下游（依赖它的任务）发 contract 告警事件，并把上游 id 写入下游 conflictWith
- [x] 无冲突时不发事件、不改写
- [x] 单元测试：真实 git 两个 worktree 改同一文件 / 改契约文件 / 无重叠

## 技术路线

编排式：changedFiles（gitprov，S0.5 已验证 merge-base 语义）→ 集合求交（JS）→ 事件/字段写入（data 仓储）。定时轮询由 server 装配（M6，间隔 cfg.radarIntervalMs）。

## 原理

冲突预警的价值在「合并前」：worktree 分支已提交但未合入 main 的窗口期就是预警窗口。契约变更比文件重叠更隐蔽也更高价值——下游 agent 的上下文里 spec 已过期，这正是 PRD 2.1 痛点 3 的解法。

## 输入 / 输出

- 输入：gitprov.changedFiles、TasksRepo/DepsRepo/EventsRepo
- 输出：`ConflictRadar.sweep`；server 定时任务（M6）与看板消费

## 上下游依赖

- 上游：S0.3、S0.5、S2.3（downstreamOf 语义）
- 下游：server 装配、S6.3 冒烟

## 接口签名

```ts
export interface InFlightItem { taskId: string; dir: string }
export interface SweepReport {
  fileConflicts: { a: string; b: string; files: string[] }[]
  contractAlerts: { taskId: string; downstream: string[]; files: string[] }[]
}
export class ConflictRadar {
  constructor(deps: { git: GitProvider; baseBranch?: string; tasks: TasksRepo; deps: DepsRepo; events: EventsRepo; contractDirs?: string[] })
  sweep(items: InFlightItem[]): Promise<SweepReport>
}
```

## 测试清单

- `radar.test.ts`：双 worktree 同文件 → pair+事件+conflictWith 双向；契约文件 → 下游告警；无重叠 → 空 report；重复 sweep 幂等（不重复发事件）

## 报错与解决

（滚动追加）

## 实际偏差

无。
