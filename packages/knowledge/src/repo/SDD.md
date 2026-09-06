# SDD: S1.2 知识仓库服务

## 任务描述

knowledge/ 目录的「唯一写入通道」：目录脚手架、全量扫描入库（人读的文件 ↔ db 索引 ↔ 全文检索三视图同步）、propose 写入（文件+git commit+artifact 行+事件）、路径生成策略、历史查询。对应 PRD F2.2。

## 目标与验收

- [x] ensureScaffold 幂等：init git、创建五目录、注入 .gitkeep 使空目录可提交
- [x] propose 按类型生成路径：adr 自动编号 0001/0002…；card/reading 带 YYYY-MM-DD 前缀；spec/agent-doc 同名 slug 复用（更新而非新建）
- [x] propose 一次调用完成四件事：写文件 → git commit（message 含 actor）→ artifacts 表 upsert → `artifact.proposed` 事件（可选 outbox）
- [x] scan：五目录递归扫 *.md，解析成功 upsert（并触发检索索引钩子），解析失败跳过并 warn；清除 db 中已不存在文件的残留行
- [x] history(path) 返回该文件 commit 历史
- [x] 单元测试：临时目录真实 git + 真实 sqlite

## 技术路线

「文件是事实源，db 是缓存/索引」：任何时刻删掉 data 目录，scan() 可完整重建。propose 是唯一写入口（agent 与人共用），保证 agent 无法绕过 Git 留下不可审计的写入。

## 原理

```
propose(input)
  → filePathFor(input)          # 类型化路径策略，adr 编号 = 现存最大号+1
  → serializeKnowledgeFile(fm, body)
  → git.commitFiles([path], msg)
  → artifacts.upsert(Artifact)
  → events.append(artifact.proposed)
  → indexer?.index(path, title, tags, body)
```

## 输入 / 输出

- 输入：S1.1 模型、S0.5 gitprov、S0.3 artifacts/events 仓储
- 输出：`KnowledgeRepo`；server API（S2.x/§9 propose/artifacts/history）、MCP propose/latest（S1.5）、蒸馏器（S5.2）消费

## 上下游依赖

- 上游：S1.1、S0.3、S0.5
- 下游：S1.3（indexer 钩子实现方）、S1.5、S2.x server 路由、S5.2

## 接口签名

```ts
export interface ProposeInput {
  type: ArtifactType; title: string; body: string
  tags?: string[]; owner?: string | null; status?: string; expires?: string
  actor: Actor                                   // { actorType, actorId }
}
export interface KnowledgeRepoDeps {
  knowledgeDir: string; git: GitProvider
  artifacts: ArtifactsRepo; events?: EventsRepo
  indexer?: { index(path, title, tags, body): Promise<void> | void; remove(path): Promise<void> | void }
  logger?: Logger
}
export class KnowledgeRepo {
  ensureScaffold(): Promise<void>
  scan(): Promise<Artifact[]>
  read(path: string): Promise<{ parsed: ParsedKnowledge; raw: string }>
  propose(input: ProposeInput): Promise<{ path: string; sha: string | null }>
  history(path: string): Promise<CommitInfo[]>
  recentChanges(n?: number): Promise<CommitWithFiles[]>   // S1.2 扩展：供 MCP latest（gitprov 新增 logWithFiles）
}
```

## 测试清单

- `knowledge-repo.test.ts`：scaffold 幂等；propose card 落盘+入库+事件+commit；adr 连续编号；spec 同 slug 更新不新建；scan 索引合法文件/跳过坏文件/清除残留行；read 未知路径 NOT_FOUND；history 非空

## 报错与解决

（滚动追加）

## 实际偏差

无。

## 报错与解决

1. **报错**：ensureScaffold 首次调用报 `git init 失败`（stderr 空）。根因：先 init 后建目录，git 的 cwd 不存在。
   **解决**：LocalGitProvider.ensureRepo 增加 `mkdirSync(dir,{recursive:true})`——「ensure」语义本就该确保目录存在；gitprov 测试同步回归通过。
2. **报错（测试期望错误）**：对 scan 直接入库但未提交的文件断言 history 非空。scan 刻意保持 git 只读（文件是事实源，提交由 propose 负责），未提交文件无历史是正确行为。
   **解决**：测试区分「propose 已提交 → history ≥1」与「scan 未提交 → history =0」两种语义。

## 实际偏差

- ArtifactsRepo 增加 `removeByPath`（scan 清残留所需），属 S0.3 接口的小幅扩展，已在 data 包实现。
