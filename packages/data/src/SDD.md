# SDD: S0.3 数据层（data 包）

## 任务描述

SQLite 持久层：六张核心表的 DDL、迁移执行、基于 Drizzle 的类型化仓储。所有仓储以 core 领域类型为边界（入参/出参都是领域对象，JSON 数组字段在仓储内编解码）。对应 TECH §4。

## 目标与验收

- [x] `createDb(file)` 建库并自动跑迁移（幂等，可重复调用）
- [x] 六表仓储：members/sessions/tasks/task_deps/artifacts/events 的 CRUD 与专项查询
- [x] 仓储出入参为 core 领域类型（Task/Member/…），tags/conflictWith 等 JSON 数组透明编解码
- [x] events 支持追加、拉取未消费、标记已消费（outbox 消费原语）
- [x] 单元测试：临时目录真实文件库跑全部仓储路径

## 技术路线

- ORM：drizzle-orm（类型化查询）+ **@libsql/client** 驱动。
- 驱动理由：libsql 客户端为 napi 预编译（与 Node ABI 无关），规避 better-sqlite3 在 Node 26 上无预编译二进制、需本地 Xcode 编译的风险；且 libsql 内含 FTS5，供 S1.3 使用。
- 迁移：**手写 DDL + `_migrations` 版本表**（`CREATE TABLE IF NOT EXISTS` 全幂等），不引入 drizzle-kit 代码生成流水线（6 张表规模下收益低于维护成本）。

## 原理

```
createDb(file) → client = createClient({url: file:xxx})
              → ensureMigrations(client)：SELECT count(*) FROM _migrations WHERE name=?
                 未应用 → client.executeMultiple(DDL)
              → drizzle(client) 包装
仓储层：row ⇄ domain 映射集中在各 repo 文件，禁止上层接触 row 结构
```

## 输入 / 输出

- 输入：core 实体 schema（表结构与 zod 一一对应）
- 输出：`createDb / Db` 类型与六个仓储；被 knowledge(S1.2/S1.3)、tasks(S2.x)、server 消费

## 上下游依赖

- 上游：S0.2 core、S0.4 infra
- 下游：S1.2 知识仓库、S1.3 检索、S2.1-S2.3 任务总线、S3.4 sessions、server 装配

## 接口签名

```ts
export function createDb(file: string): Db          // { client, db }
export function closeDb(db: Db): Promise<void>

export class MembersRepo { insert(m: Member); get(id); getByName(name); list(): Member[] }
export class TasksRepo { insert(t: Task); get(id); update(t: Task); list(f?: {status?, module?, assigneeMemberId?}): Task[] }
export class DepsRepo { add(d: TaskDep); remove(taskId, dependsOnTaskId); forTask(taskId): TaskDep[]; all(): TaskDep[] }
export class SessionsRepo { upsert(s: AgentSession); get(id); heartbeat(id, at); touch(s: Partial & id); list(): AgentSession[] }
export class ArtifactsRepo { upsert(a: Artifact); get(id); getByPath(path); list(f?): Artifact[] }
export class EventsRepo { append(e: Event); pending(limit): Event[]; markConsumed(ids: string[], at); byTaskRef?(taskId) }
```

## 测试清单

- `db.test.ts`：临时目录建库→迁移幂等（createDb 两次不炸）→ 全部仓储 CRUD 往返 → JSON 字段编解码 → events pending/markConsumed

## 报错与解决

1. **报错**：依赖边测试报 `SQLITE_CONSTRAINT_FOREIGNKEY (787)`——`task_deps` 外键要求两端任务已存在，而测试直接用 `newId()` 造了一个未入库的 upstream id。
   **解决**：这是 FK 正确拦截脏数据，非 schema 缺陷。修正测试先插入 upstream 任务。结论保留 FK 约束（对上层是保护：S2.3 建依赖边时必须先建任务）。

## 实际偏差

- TECH §4 写的是 better-sqlite3；实际改用 @libsql/client（原因见技术路线），TECH 不回改，以本 SDD 为准。
- TECH §4 写 drizzle-kit 生成迁移；实际为手写幂等 DDL + `_migrations` 表（理由见技术路线）。
