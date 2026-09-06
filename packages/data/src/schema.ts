import { sqliteTable, text, index } from "drizzle-orm/sqlite-core";

/** 与 migrations.ts 的 DDL 保持一致（仓储测试兜底）。JSON 数组字段以 TEXT 存 json 字符串，由仓储层编解码。 */

export const members = sqliteTable("members", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  role: text("role").notNull(),
  tokenHash: text("token_hash").notNull(),
  createdAt: text("created_at").notNull(),
});

export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    dod: text("dod").notNull(),
    module: text("module"),
    tags: text("tags").notNull().default("[]"),
    assigneeMemberId: text("assignee_member_id"),
    assigneeSessionId: text("assignee_session_id"),
    status: text("status").notNull().default("draft"),
    blockedFrom: text("blocked_from"),
    conflictWith: text("conflict_with").notNull().default("[]"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("idx_tasks_status").on(t.status)],
);

export const taskDeps = sqliteTable("task_deps", {
  taskId: text("task_id").notNull(),
  dependsOnTaskId: text("depends_on_task_id").notNull(),
  kind: text("kind").notNull().default("sequence"),
});

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    memberId: text("member_id").notNull(),
    adapter: text("adapter").notNull(),
    taskId: text("task_id"),
    branch: text("branch"),
    status: text("status").notNull(),
    diffSummary: text("diff_summary"),
    lastHeartbeatAt: text("last_heartbeat_at").notNull(),
  },
  (t) => [index("idx_sessions_member").on(t.memberId)],
);

export const artifacts = sqliteTable("artifacts", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  path: text("path").notNull().unique(),
  title: text("title").notNull(),
  tags: text("tags").notNull().default("[]"),
  owner: text("owner"),
  status: text("status").notNull().default("accepted"),
  expiresAt: text("expires_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const events = sqliteTable(
  "events",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(),
    payload: text("payload").notNull(),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id").notNull(),
    createdAt: text("created_at").notNull(),
    consumedAt: text("consumed_at"),
  },
  (t) => [index("idx_events_consumed").on(t.consumedAt)],
);
