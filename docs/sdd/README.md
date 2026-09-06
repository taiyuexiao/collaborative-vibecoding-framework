# SDD（Spec-Driven Development）开发规范

本项目采用 SDD 模式开发：**每个子模块（=一个独立任务单元）必须在自己的代码目录内挂一个 `SDD.md`**，先写规格再写代码，开发过程中滚动维护。

## 1. SDD.md 位置

```
packages/<pkg>/src/<submodule>/SDD.md      # 子模块级
```

示例：`packages/core/src/state-machine/SDD.md`、`packages/knowledge/src/repo/SDD.md`。

## 2. SDD.md 模板

```markdown
# SDD: <S编号> <子模块名>

## 任务描述
做什么，为什么存在（对应 PRD 哪条需求）。

## 目标与验收
可验证的完成标准（勾选列表）。

## 技术路线
选型与理由（一句话级别，详细约定回链 TECH.md）。

## 原理
核心机制：图 / 伪代码 / 关键决策。

## 输入 / 输出
上游交付物（依赖哪些子模块的什么）；本模块产出（导出什么、被谁消费）。

## 上下游依赖
上游：Sx.y（什么）；下游：Sy.z（把本模块当什么用）。

## 接口签名
导出的函数/类型签名清单。

## 测试清单
测试文件与覆盖的关键分支。

## 报错与解决
开发中遇到的真实报错（原样贴关键行）与解决方法。滚动追加，按时间排序。

## 实际偏差
与计划的差异及原因（没有写"无"）。
```

## 3. 工作流（每个子模块五步）

1. **写规格**：按模板写 SDD.md 前七节（任务描述→接口签名），此时不写代码
2. **实现**：代码 + colocated 单元测试（`*.test.ts`）
3. **验证**：`pnpm test` 全绿；遇报错原样记录进「报错与解决」并写解决方法
4. **收尾**：补全「测试清单」「实际偏差」
5. **勾选**：更新 `docs/PLAN.md` 对应状态

## 4. SDD 索引

各子模块 SDD.md 随开发就位后在此登记：

<!-- 由开发过程滚动维护 -->

- [S0.1 monorepo 脚手架](./S0.1-monorepo脚手架.md)（仓库级子模块，SDD 归档于 docs/sdd/）
- [S0.2 领域模型](../../packages/core/src/SDD.md)
- [S0.4 基建件](../../packages/infra/src/SDD.md)
- [S0.3 数据层](../../packages/data/src/SDD.md)
- [S0.5 GitProvider](../../packages/gitprov/src/SDD.md)
- [S1.1 知识对象模型](../../packages/knowledge/src/model/SDD.md)
- [S1.2 知识仓库服务](../../packages/knowledge/src/repo/SDD.md)
- [S1.3 检索服务](../../packages/knowledge/src/search/SDD.md)
- [S1.4 渲染服务](../../packages/knowledge/src/render/SDD.md)
- [S1.5 MCP server](../../packages/mcp/src/SDD.md)
- [S2.1-S2.3 任务服务](../../packages/tasks/src/SDD.md)
- [S2.4 看板 Web UI](../../packages/web/src/SDD.md)
- [server 装配与路由](../../packages/server/src/SDD.md)
- [S3.1-S3.3 会话桥 daemon](../../packages/daemon/src/SDD.md)
- [S4.1-S4.2 冲突雷达](../../packages/radar/src/SDD.md)
- [S5.1-S5.3 蒸馏器](../../packages/distiller/src/SDD.md)
- [S6.2 通知出口](../../packages/server/src/notify-SDD.md)
- [S6.3 端到端冒烟](../../packages/server/src/smoke-e2e-SDD.md)
