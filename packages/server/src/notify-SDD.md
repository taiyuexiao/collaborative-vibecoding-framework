# SDD: S6.2 通知出口（webhook 抽象 + 飞书 bot 最小实现）

## 任务描述
digest/告警的对外推送通道抽象 NotifyChannel：FeishuWebhookChannel（群机器人）+ NullChannel（未配置时仅记日志，链路不断）。server 新增 GET /api/v1/digest 与 POST /api/v1/digest/send。对应 PRD F6.3/F7 最小集。

## 目标与验收
- [x] notifyFromConfig：有 feishuWebhook → 飞书实现，否则 Null
- [x] digest 路由：hours 参数聚合近 N 小时事件
- [x] send 路由需认证；成功后广播 notify.sent
- [x] main.ts 定时装配：蒸馏循环（5s 消费 outbox）+ 雷达循环（radarIntervalMs 扫本机 worktree）

## 技术路线
飞书自定义群机器人 webhook（msg_type=text），无 SDK 依赖；钉钉/Slack 后续实现同一接口。

## 原理
雷达扫描范围 = cfg.repoDir/.superteam-worktrees/<taskId>（本机可见的 worktree）；远端成员分支由其本机后续上报（预留扩展）。

## 输入 / 输出
输入：DigestService（S5.3）、config（feishuWebhook/repoDir/radarIntervalMs）。输出：推送通道 + 定时循环。

## 上下游依赖
上游：S5.1-S5.3、S0.4 config 扩展（repoDir/feishuWebhook）。下游：飞书群、看板 notify.sent。

## 测试清单
UI 外部依赖不做单测；digest/send 由 S6.3 端到端冒烟间接覆盖（digest 生成路径）。

## 报错与解决
无。

## 实际偏差
自动定时推送日报未做（24h cron 留部署层），MVP 提供手动 send 路由。
