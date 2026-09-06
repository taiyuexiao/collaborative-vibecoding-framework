# 共工（Superteam）模块拆分与进度跟踪（PLAN）

> 规则：每个子模块 = 一个独立任务单元。完成定义（DoD）：代码实现 + 单元测试全绿 + 子模块目录内 `SDD.md` 完整（含「报错与解决」）+ 本表勾选。
> 拆包结构见 `docs/TECH.md` §2。状态图例：⬜ 未开始 · 🔶 进行中 · ✅ 完成

## 文档

| # | 子模块 | 位置 | 状态 |
|---|---|---|---|
| D.1 | PRD 产品文档 | docs/PRD.md | ✅ |
| D.2 | TECH 技术文档 | docs/TECH.md | ✅ |
| D.3 | 拆分与跟踪表 | docs/PLAN.md | ✅ |
| D.4 | SDD 规范 | docs/sdd/README.md | ✅ |

## M0 工程基建

| # | 子模块 | 包/位置 | 依赖 | 状态 |
|---|---|---|---|---|
| S0.1 | monorepo 脚手架 | 根 + 各包基础 | - | ✅ |
| S0.2 | 领域模型（类型+zod+状态机） | packages/core | S0.1 | ✅ |
| S0.4 | 基建件（配置/日志/错误） | packages/infra | S0.1 | ✅ |
| S0.3 | 数据层（Drizzle+SQLite+仓储） | packages/data | S0.2,S0.4 | ✅ |
| S0.5 | GitProvider + 本地实现 | packages/gitprov | S0.2,S0.4 | ✅ |

## M1 知识档案层

| # | 子模块 | 包/位置 | 依赖 | 状态 |
|---|---|---|---|---|
| S1.1 | 知识对象模型（front-matter 规范） | packages/knowledge/src/model | S0.2 | ⬜ |
| S1.2 | 知识仓库服务（扫描/propose/历史） | packages/knowledge/src/repo | S1.1,S0.5 | ⬜ |
| S1.3 | 检索服务（FTS5+标签） | packages/knowledge/src/search | S0.3,S1.1 | ⬜ |
| S1.4 | 渲染服务（markdown→HTML/TOC） | packages/knowledge/src/render | S1.1 | ⬜ |
| S1.5 | MCP server（search/read/propose/latest） | packages/mcp | S1.2,S1.3 | ⬜ |

## M2 任务总线

| # | 子模块 | 包/位置 | 依赖 | 状态 |
|---|---|---|---|---|
| S2.1 | 任务 CRUD API | packages/tasks/src/routes | S0.3 | ⬜ |
| S2.2 | 状态机迁移 + 事件 outbox | packages/tasks/src/state | S0.2,S0.3 | ⬜ |
| S2.3 | 依赖图（环检测/下游通知） | packages/tasks/src/deps | S2.1 | ⬜ |
| S2.4 | 看板 Web UI 一版 | packages/web | S2.1,S2.2 | ✅ |

## M3 会话桥 daemon

| # | 子模块 | 包/位置 | 依赖 | 状态 |
|---|---|---|---|---|
| S3.1 | daemon 骨架（注册/心跳/WS） | packages/daemon | S2.x API | ✅ |
| S3.2 | AgentAdapter 抽象 + claude-code/echo 适配器 | packages/daemon/src/adapters | S3.1 | ✅ |
| S3.3 | 任务执行器（worktree+prompt 组装+回写） | packages/daemon/src/executor | S3.2 | ✅ |
| S3.4 | 服务端 sessions 模块 | packages/server | S3.1 | ✅ |

## M4 冲突雷达

| # | 子模块 | 包/位置 | 依赖 | 状态 |
|---|---|---|---|---|
| S4.1 | 在途分支 diff 扫描器 | packages/radar | S0.5 | ✅ |
| S4.2 | 重叠分析器（文件求交+契约变更→告警事件） | packages/radar | S4.1,S2.3 | ✅ |

## M5 蒸馏器

| # | 子模块 | 包/位置 | 依赖 | 状态 |
|---|---|---|---|---|
| S5.1 | 事件订阅框架 + 规则引擎 | packages/distiller | S2.2 | ✅ |
| S5.2 | 问答→经验卡链路（LLM 起草→propose） | packages/distiller | S5.1,S1.2 | ✅ |
| S5.3 | 每日 digest 生成器 | packages/distiller | S5.1 | ✅ |

## M6 集成收尾

| # | 子模块 | 包/位置 | 依赖 | 状态 |
|---|---|---|---|---|
| S6.1 | 档案站 Web 视图 | packages/web | S1.4 | ✅ |
| S6.2 | 通知出口（webhook+飞书 bot 最小实现） | packages/server/src/notify | S5.3 | ✅ |
| S6.3 | 端到端冒烟（一键启动+全链路测试） | scripts + packages/server | 全部 | ✅ |

## 里程碑

- [x] MS1：M0+M1+M2 —— 知识库+任务总线+MCP+看板可用（curl 冒烟通过） —— 知识库+任务总线+MCP 可用
- [x] MS2：M3+M4 —— 任务执行闭环+冲突预警
- [x] MS3：M5+M6 —— 蒸馏、档案站、通知、端到端冒烟

## 补充工具链

| # | 内容 | 位置 | 状态 |
|---|---|---|---|
| T.1 | 演示数据种子 | scripts/seed-demo.ts（pnpm seed） | ✅ |
| T.2 | 全功能 E2E 扫描（43 项，真实 main.ts + MCP stdio + WS） | scripts/e2e-full.ts | ✅ |

## 变更记录

- 2026-09-06 v0.1 初版拆分（PRD/TECH 定稿后）
- 2026-09-06 v0.2 E2E 扫描：修复装配层雷达过滤、畸形 JSON 500、config env 映射漏配、UI 401 恢复、WS 重连、digest 口径
