# SDD: S5.1-S5.3 蒸馏器（事件消费框架 / 任务→经验卡 / 每日 digest）

## 任务描述

消费 events outbox，把协作流中高价值信息提炼为知识档案：任务 done → LLM 起草经验卡（propose，actor=agent）；聚合事件生成 digest。对应 PRD F6.1-F6.3（MVP 链路：任务闭环→经验卡；问答流在 P1 扩展为第二个规则）。

## 目标与验收

- [x] `EventConsumer.consumeOnce(handler)`：拉 pending 事件 → 逐条分发 → 无论成败都 markConsumed（毒丸防护，失败记日志）
- [x] `DistillRules`：按事件类型注册 handler；`task.transitioned(to=done)` → LLM 起草 card → knowledge.propose（actor=agent，可审计）
- [x] `LlmClient`：OpenAI 兼容 /chat/completions（fetch 可注入便于测试）；**未配置 LLM 时 NullLlm 确定性模板降级**——链路不因缺配置而断
- [x] `DigestService.generate(sinceHours)`：聚合任务迁移/冲突/新知识 → markdown
- [x] 单元测试：真实库 + NullLlm 覆盖三条链路

## 技术路线

规则 = `{ name, types: EventType[], handle(event) }`；consumer 是通用 outbox 消费骨架，与规则解耦（雷达/通知未来可复用同一骨架）。LLM 只是起草器：产出必须经 propose（Git 留痕）+ 人审（MVP 由档案站可见性承载，S6.1 展示 actor）。

## 原理

```
events(pending) ─▶ consumer ─▶ rules[type].handle(event)
                                   │
                                   ├─ LlmClient.complete(起草经验卡)
                                   └─ knowledge.propose(card) → git commit + artifact.proposed 事件
```

## 输入 / 输出

- 输入：S0.3 EventsRepo、S1.2 KnowledgeRepo、S0.4 config（llmBaseUrl/llmApiKey/llmModel）
- 输出：`EventConsumer / DistillRules / DigestService / LlmClient`；server 定时装配（M6）与 `/api/v1/digest` 路由消费

## 上下游依赖

- 上游：S2.2（事件）、S1.2（写入）
- 下游：server 装配、S6.2 通知出口（digest 推送）

## 接口签名

```ts
export interface LlmClient { complete(system: string, user: string): Promise<string> }
export class OpenAiCompatLlm implements LlmClient   // {baseUrl, apiKey, model, fetchImpl?}
export class NullLlm implements LlmClient           // 确定性模板降级

export interface DistillRule { name: string; types: string[]; handle(e: Event): Promise<void> }
export function taskDoneCardRule(deps: { knowledge: KnowledgeRepo; llm: LlmClient }): DistillRule

export class EventConsumer {
  constructor(events: EventsRepo, logger?: Logger)
  consumeOnce(rules: DistillRule[]): Promise<number>   // 返回处理条数
}
export class DigestService {
  constructor(deps: { events: EventsRepo; tasks: TasksRepo })
  generate(sinceHours?: number): Promise<string>
}
```

## 测试清单

- `rules.test.ts`：done 事件 → card 文件落盘+actor=agent；非 done 事件不触发；NullLlm 模板含任务标题
- `consumer.test.ts`：pending 分发+markConsumed；handler 抛错事件也被消费（毒丸防护）
- `digest.test.ts`：聚合迁移/告警/新知识三类事件成 markdown
- `llm.test.ts`：OpenAiCompatLlm 请求形状（mock fetch）；NullLlm 模板

## 报错与解决

（滚动追加）

## 实际偏差

- PRD F6.2 的「问答→经验卡」依赖 P1 的流层（话题化讨论），MVP 以「任务 done→经验卡」作为首条蒸馏链路；问答规则留接口（rules 数组天然可扩展）。

## 报错与解决

1. **报错（设计期发现）**：taskDoneCardRule 首版依赖事件负载里的 task 详情，但 S2.2 的 task.transitioned 只带 from/to/action——规则只能抛错或回查。
   **解决**：在事件源头丰富负载（TaskService.transitioned 附带任务快照 title/dod/description/module），规则缺详情时静默跳过（兼容旧事件）。教训：事件负载设计要站在消费者视角。

## 实际偏差

无（问答规则见上）。
