# SDD: S1.3 检索服务（FTS5 + 标签/类型过滤）

## 任务描述

基于 SQLite FTS5 的档案全文检索：中文按字分词、latin 词原样；类型（按路径前缀）与标签（JS 后过滤）过滤；返回高亮 snippet。对应 PRD F2.3。

## 目标与验收

- [x] `index/remove/query` 三方法；index 以 path 为 key 幂等覆盖
- [x] 中文查询「幂等」能命中含「幂等处理」的文档（短语匹配，非乱序 AND）
- [x] query 不带 text 时退化为过滤列表（type/tags/limit）
- [x] snippet 返回 body 列的高亮片段（`[]` 标记）
- [x] 单元测试：真实 libsql（临时文件库）

## 技术路线

FTS5 + `tokenize='unicode61'`（libsql 内建，无需外部分词器）。写入时把相邻 CJK 字符以空格分隔（每个汉字独立 token），查询时把 CJK 词组转成带引号的**短语查询**（`"幂 等"`），保证词序相邻性；latin 词不动。

## 原理

```
toSearchable("支付回调idempotent处理")
  → "支 付 回 调 idempotent 处 理"           # 写入侧：CJK 切分
buildMatch("支付 幂等")
  → '"支 付" AND "幂 等"'                    # 查询侧：CJK 词组→短语；词间 AND
SELECT path, title, tags, snippet(artifact_fts, 3, '[', ']', '…', 16)
FROM artifact_fts WHERE artifact_fts MATCH ? ORDER BY rank LIMIT ?
```

## 输入 / 输出

- 输入：S0.3 的 artifact_fts 虚表（migration 0002）
- 输出：`SearchService`；由 KnowledgeRepo（indexer 钩子）喂数据；server API / GET /artifacts 与 MCP search 消费

## 上下游依赖

- 上游：S0.3（fts 表 + client）、S1.1（目录→类型映射）
- 下游：S1.5 MCP、server 路由、S6.1 档案站搜索

## 接口签名

```ts
export function toSearchable(s: string): string
export function buildMatchQuery(text: string): string | null
export interface SearchHit { path: string; title: string; tags: string[]; snippet: string }
export interface SearchQuery { text?: string; type?: ArtifactType; tags?: string[]; limit?: number }
export class SearchService {
  constructor(client: Client)                       // @libsql/client
  index(path: string, title: string, tags: string[], body: string): Promise<void>
  remove(path: string): Promise<void>
  query(q: SearchQuery): Promise<SearchHit[]>
}
```

## 测试清单

- `search-service.test.ts`：toSearchable/buildMatchQuery 纯函数；中文短语命中与不命中；latin/标签命中；type+tags 过滤；remove 后不再命中；limit 生效；空查询退化为过滤列表

## 报错与解决

（滚动追加）

## 实际偏差

无。

## 报错与解决

1. **报错**：`LibsqlError: UPSERT not implemented for virtual table "artifact_fts"`——FTS5 虚表不支持 `ON CONFLICT DO UPDATE`。
   **解决**：index() 改为标准 delete-then-insert（同 path 幂等语义不变）。
2. **报错（测试发现）**：`toSearchable` 首版只切「汉字↔汉字」边界，`支付idempotent处理` 归一成 `支 付idempotent处 理`——unicode61 把 `付idempotent` 视为单个 token，会破坏 latin 边界命中。
   **解决**：补全双向边界（汉字→latin、latin→汉字），最终 `支 付 idempotent 处 理`。教训：分词器的边界语义必须用纯函数测试钉死。

## 实际偏差

无。

### S1.3 补充：index 列语义修正（S1.5 发现）

2. **报错**：MCP search 命中结果把 title 返回成了分词归一后的文本（「FTS 中 文 检 索 坑」）。
   **解决**：title/tags 列存**原文**（展示用）；检索文本 = toSearchable(title+tags+body) 并入 body 列（中文短语命中所需）。检索列与展示列分离。
