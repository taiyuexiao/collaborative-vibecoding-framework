# SDD: S0.4 基建件（infra 包）

## 任务描述

提供全系统共用的运行时基建：配置加载（环境变量 + 可选配置文件）、pino 结构化日志、错误→HTTP 状态映射。对应 TECH §1（日志选型）与 server/daemon 的公共需求。

## 目标与验收

- [x] `loadConfig(env)`：从传入的 env（默认 process.env）读取配置，zod 校验，带类型与默认值；缺失关键配置不抛错（全部有默认值）
- [x] `createLogger(name, level)`：pino logger，带模块名子 logger；level 可配
- [x] `statusForError(err)`：AppError.code → HTTP 状态码映射；未知错误归 500 且不泄露内部消息
- [x] 单元测试覆盖默认值、env 覆盖、非法值拒绝、错误映射

## 技术路线

配置注入用「传 env 对象」而非直接读 process.env——测试无污染。pino 只在 infra 依赖一次，其他包注入 logger 实例。

## 原理

Config 字段与优先级：`默认值 < 配置文件（superteam.config.json，可选） < 环境变量`。MVP 先实现 env 层；文件层留 TODO（无消费方前不做）。

## 输入 / 输出

- 输入：TECH §9（端口、路径约定）、PRD §6（可观测）
- 输出：`loadConfig / createLogger / statusForError`；server、daemon、mcp、distiller 消费

## 上下游依赖

- 上游：S0.1 脚手架、S0.2 core（AppError）
- 下游：S0.3 data（数据目录配置）、S1.x knowledge、S2.x tasks、server/daemon/mcp/distiller

## 接口签名

```ts
export interface SuperteamConfig {
  port: number;                 // SUPERTEAM_PORT，默认 7300
  host: string;                 // SUPERTEAM_HOST，默认 127.0.0.1
  dataDir: string;              // SUPERTEAM_DATA_DIR，默认 ./data
  knowledgeDir: string;         // SUPERTEAM_KNOWLEDGE_DIR，默认 ./knowledge
  logLevel: string;             // SUPERTEAM_LOG_LEVEL，默认 info
  llmBaseUrl?: string;          // SUPERTEAM_LLM_BASEURL
  llmApiKey?: string;           // SUPERTEAM_LLM_APIKEY
  llmModel?: string;            // SUPERTEAM_LLM_MODEL，默认 glm-4.7
  radarIntervalMs: number;      // SUPERTEAM_RADAR_INTERVAL_MS，默认 30000
}
export function loadConfig(env?: Record<string, string | undefined>): SuperteamConfig
export function createLogger(name: string, level?: string): pino.Logger
export function statusForError(err: unknown): number
```

## 测试清单

- `config.test.ts`：默认值；PORT/RADAR 间隔数字解析；非法数字被 zod 拒绝走默认值策略（拒绝整体 or 回退——采用「非法即报 VALIDATION_FAILED」以免静默错配，测试断言抛 AppError）
- `errors.test.ts`：六个 code → 状态码映射；非 AppError → 500

## 报错与解决

（暂无）

## 实际偏差

无。
