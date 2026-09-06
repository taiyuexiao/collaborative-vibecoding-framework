# SDD: S6.3 端到端冒烟

## 任务描述
一条测试跑通产品全生命周期：建双任务 → daemon(echo) 执行双 worktree → 雷达发现重叠 → 验收 → 蒸馏出经验卡 → 日报聚合。对应 PRD 场景 A/B/C 的串联验证。

## 目标与验收
- [x] 6 步全链路在一个测试文件内完成（真实 server + 真实 git + echo adapter + NullLlm）
- [x] 验证看板数据源：task.conflictWith、搜索命中经验卡、日报含三类信息

## 技术路线
复用各包公开 API（buildServer/createContext/TaskExecutor/ConflictRadar/EventConsumer），不 mock 内部——mock 只允许出现在网络边界（本测试无）。

## 原理
echo adapter 写同名 echo-output.md，天然制造文件重叠场景，无需构造真实代码冲突。

## 输入 / 输出
输入：全部模块。输出：CI 可跑的回归门禁（pnpm test）。

## 报错与解决
1. **报错（冒烟发现真 bug）**：③ 步 fileConflicts=0。根因：雷达 IN_FLIGHT_STATUSES 漏了 waiting_review——「已提交待评审」的分支恰恰是未合入 main 的高危窗口。
   **解决**：在途状态补 waiting_review。教训：状态机的每个状态都要问一句「它在雷达眼里算不算在途」。

## 实际偏差
无。
