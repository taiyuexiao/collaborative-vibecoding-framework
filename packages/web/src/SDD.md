# SDD: S2.4 看板 Web UI（一版）

## 任务描述
React SPA：成员注册门（token 存 localStorage）、七列看板、任务卡（模块/标签/DoD/冲突标记）、状态迁移按钮（显隐由 core 的 allowedActions 驱动）、任务详情侧栏（依赖增删）、agent 会话面板、WS 实时刷新。对应 PRD F1.4、F4.4 的展示面。

## 目标与验收
- [x] 未注册时显示 bootstrap 表单；注册后进入看板
- [x] 看板按状态分列；卡片迁移按钮与后端同一状态机（import @superteam/core）
- [x] 详情侧栏：依赖列表 + 下拉添加依赖（PUT deps PUT 语义）
- [x] WS 收到任意事件即刷新任务/会话
- [x] `npx tsc --noEmit` 零错误；`vite build` 成功

## 技术路线
Vite + React，无 UI 框架（手写 design tokens CSS）；dev 经 vite proxy 转发 /api 与 /ws 到 7300。

## 原理
按钮渲染 = allowedActions(status) 过滤 cancel——前后端共享同一迁移表，天然不会出现「后端拒绝的按钮」。

## 输入 / 输出
输入：server REST + WS。输出：看板 UI。

## 上下游依赖
上游：server 全部路由；core。下游：S6.1 档案站视图扩展本包。

## 测试清单
UI 组件无单测（MVP 决策：核心逻辑在 core/tasks 已覆盖，UI 由 S6.3 端到端冒烟 + 手工冒烟覆盖）。已验证：tsc 零错、vite build 成功、curl 冒烟后端全链路。

## 报错与解决
1. **报错**：`npx tsc` 报 JSX flag 缺失——脚手架期生成的占位 tsconfig.json 挡住了 Write 工具的首次写入（误以为已写）。
   **解决**：重写 tsconfig（jsx: react-jsx + DOM lib）。
2. **报错**：core TRANSITIONS 类型含 "SELF" 导致 transition() 返回类型不匹配。
   **解决**：表类型放宽为 `TaskStatus | "SELF"`；transition 末段显式收窄。

## 实际偏差
无。

---

# SDD: S6.1 档案站 Web 视图

## 任务描述
在 web 包新增「知识库」标签页：全文检索（中文短语）+ 类型过滤、命中列表（高亮 snippet）、文档详情（front-matter 元数据 + TOC + 渲染 HTML）、共工日报预览。对应 PRD F2.4。

## 目标与验收
- [x] 顶栏双 Tab（任务看板 / 知识库）
- [x] 检索与过滤走 GET /api/v1/artifacts；详情走 /api/v1/artifacts/:path
- [x] 日报按钮调 GET /api/v1/digest 渲染 markdown 原文
- [x] tsc 零错误、vite build 成功

## 技术路线
详情 HTML 由服务端 renderKnowledge 产出（S1.4），前端 dangerouslySetInnerHTML——信任边界在写入口 propose（团队 Git 仓库），与 TECH §5.4 的决策一致。

## 上下游依赖
上游：S1.4/S1.5 服务、server 路由。下游：无。

## 测试清单
UI 无单测（同 S2.4 决策），由 S6.3 冒烟覆盖后端数据链路 + build/tsc 门禁。

## 报错与解决
无。

## 实际偏差
无。
