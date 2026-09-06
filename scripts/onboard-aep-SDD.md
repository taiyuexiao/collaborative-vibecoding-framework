# SDD: AEP 项目接入（onboard-aep.ts）

## 任务描述
把真实项目「上海银行异构智能体测评平台」（Gitee 私有仓库 + 微信传来的分工文档包）完整接入共工：成员、项目文档（specs/readings/agent-doc）、53 项任务、84 条依赖边。

## 目标与验收
- [x] 解析 xlsx 分工表（P0 学员任务清单：模块/任务/负责人/上下游依赖）→ 11 名成员 + 53 任务
- [x] docx（产品设计/功能拆分）转 markdown 入 specs；Gap 分析入 readings；仓库 AGENTS.md 快照入 agent-doc
- [x] 依赖边全部匹配（84 条），含标题自身含「、」的边
- [x] daemon 在真实 AEP 仓库执行链路：认领「创建本地账号」→ worktree task_mtpx0gdqexidib → 分支提交 → waiting_review → 验收 done → 蒸馏器自动生成【经验】卡
- [x] 浏览器视觉确认看板 53 卡渲染 + AGENT 会话面板

## 技术路线
python(openpyxl/python-docx) 导出 plan.json（成员/任务/上游原始单元格/docx转md）→ tsx 脚本调平台 API。上游依赖单元格**不预先切分**，由 ts 端「最长标题贪心匹配」解析——因为任务标题本身可能包含分隔符「、」。

## 报错与解决
1. **报错**：首个任务「创建本地账号」400 校验失败。根因：P0-01 模块负责人未定，脚本传 `assigneeMemberId: null`，但 CreateTaskSchema 是 `.optional()`（不接受 null），与 core TaskSchema 的 `.nullable()` 不一致。
   **解决**：CreateTaskSchema 改 `.nullable().optional()`；补单测。教训：同一字段在输入 schema 与领域 schema 的可空性必须一致。
2. **报错**：依赖边 3 个上游名未匹配。根因：xlsx 上游单元格按「、」切分，把标题「导出、归档与删除评测集」切碎；python 端两次修补切分正则均失败。
   **解决**：**在源头放弃切分**——导出原始单元格整串，由 ts 端贪心匹配最长已知标题并忽略分隔符残片。教训：含分隔符歧义的字段要在离歧义最远的一端处理。
3. **报错（环境）**：`data/.lead-token` cat 失败——shell 工作目录被重置；改绝对路径。

## 实际偏差
- xlsx 共 54 行，53 项有效任务（1 行为说明行）；「导出、归档与删除评测集」依赖边经贪心匹配补齐后 84 条全匹配。
