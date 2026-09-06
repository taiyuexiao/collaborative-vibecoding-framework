# SDD: S1.1 知识对象模型（front-matter 规范）

## 任务描述

定义 knowledge/ 目录下五类知识对象（spec/adr/card/reading/agent-doc）的 front-matter 规范与解析/序列化函数：类型与目录强绑定、必填字段校验、过期字段、ADR 状态枚举。对应 PRD F2.1。

## 目标与验收

- [x] `parseKnowledgeFile(relPath, raw)`：分离 front-matter 与正文；type 必须与所在目录一致；校验失败抛 AppError(VALIDATION_FAILED) 且 details 指明字段
- [x] `serializeKnowledgeFile(parsed)`：解析的逆运算，roundtrip 稳定
- [x] 五目录映射：specs/spec、adr/adr、cards/card、readings/reading、agents/agent-doc
- [x] ADR status 限枚举 proposed/accepted/superseded；card/reading 支持 expires（YYYY-MM-DD）
- [x] slug 生成函数（保留 CJK，ASCII 小写）

## 技术路线

gray-matter（YAML front-matter 事实标准）+ zod 校验。目录绑定是防呆设计：`type` 字段错误但放对目录的文件仍可被扫描修复（以目录为准的 `inferredType`）。

## 原理

路径 `cards/2026-09-06-xxx.md` → type=card（由一级目录推断）。front-matter 的 `type` 字段与目录推断不一致时——宽容策略：以目录为准并在解析结果标记 `typeMismatch: true`，扫描器（S1.2）打日志告警但不拒绝（知识库宁滥勿缺，人可后续修正）。

## 输入 / 输出

- 输入：PRD F2.1、TECH §5.2
- 输出：`parseKnowledgeFile / serializeKnowledgeFile / slugify / KNOWLEDGE_DIRS`；S1.2 仓库服务、S1.4 渲染、S6.1 档案站消费

## 上下游依赖

- 上游：S0.2（zod/AppError）
- 下游：S1.2、S1.3、S1.4

## 接口签名

```ts
export const KNOWLEDGE_DIRS = ["specs","adr","cards","readings","agents"] as const
export function dirOfType(t: ArtifactType): string
export function typeOfDir(dir: string): ArtifactType | null

export const FrontmatterSchema: z.ZodObject   // title/type/tags/owner/created/expires/status
export interface ParsedKnowledge {
  path: string; dir: string; type: ArtifactType; typeMismatch: boolean
  frontmatter: { title, type?, tags, owner?, created?, expires?, status? }
  body: string
}
export function parseKnowledgeFile(relPath: string, raw: string): ParsedKnowledge
export function serializeKnowledgeFile(fm: Record<string, unknown>, body: string): string
export function slugify(title: string): string
```

## 测试清单

- `frontmatter.test.ts`：合法解析；type/目录不一致 → typeMismatch；缺 title 报错；expires 非日期报错；adr 非法 status 报错；serialize→parse roundtrip；slugify（中文保留/空白折叠/特殊符号剔除）

## 报错与解决

1. **报错**：`expires: Expected string, received date`——gray-matter 用 js-yaml 解析，YAML 无引号日期自动转 JS Date，zod 字符串校验拒绝。
   **解决**：`created/expires` 经 `z.preprocess` 把 Date 转回 `YYYY-MM-DD` 字符串再校验。引申约定：front-matter 日期一律裸日期（YAML 原生），解析层负责归一。
2. **报错**：roundtrip 测试发现 `matter.stringify` 在正文尾部补 `\n`。
   **解决**：属无害行为，解析保留原样；测试按 `trimEnd` 比较。

## 实际偏差

无。
