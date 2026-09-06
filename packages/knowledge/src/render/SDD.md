# SDD: S1.4 渲染服务

## 任务描述

把知识 Markdown 渲染为 HTML（GFM 支持）并抽取标题目录（TOC），供档案站与 server 的 `/artifacts/:path/content` 使用。对应 PRD F2.4 的服务端部分。

## 目标与验收

- [x] `renderMarkdown(body)` → `{ html, toc }`；TOC 含 level/text/slug，slug 唯一（重复标题加序号）
- [x] GFM：表格、删除线、任务列表可渲染
- [x] 纯函数、无 IO，便于测试与复用
- [x] 单元测试：标题层级/TOC 完整性/重复 slug/代码块不被误判标题/GFM 表格

## 技术路线

unified 生态：remark-parse → remark-gfm → remark-rehype → rehype-stringify。TOC 用逐行正则抽取（``` 围栏代码块内跳过），slug 复用 S1.1 slugify + 去重计数器。

## 原理

rehype 阶段不注入 sanitize——MVP 档案站内容全部来自团队自己的 Git 仓库（信任边界在写入口 propose），前端按受信内容渲染。

## 输入 / 输出

- 输入：S1.1 解析出的 body
- 输出：`renderMarkdown / renderKnowledge`（含 front-matter 元数据透出）；server 路由、S6.1 档案站消费

## 上下游依赖

- 上游：S1.1
- 下游：S2.x server、S6.1 web

## 接口签名

```ts
export interface TocItem { level: number; text: string; slug: string }
export function renderMarkdown(body: string): { html: string; toc: TocItem[] }
export function renderKnowledge(parsed: ParsedKnowledge): {
  html: string; toc: TocItem[]
  meta: { path, type, title, tags, owner, status, expiresAt, typeMismatch }
}
```

## 测试清单

- `render-service.test.ts`：h2/h3 进 TOC 且 slug 唯一；代码块内 # 不误判；GFM 表格/删除线；meta 透出

## 报错与解决

（滚动追加）

## 实际偏差

无。

## 报错与解决

1. **报错**：`String(processor.runSync(...))` 得到 `[object Object]`——runSync 只执行到 hast 树，stringify 未跑。
   **解决**：统一用 `processor.processSync(body).toString()`（parse+run+stringify 一步到位）。
