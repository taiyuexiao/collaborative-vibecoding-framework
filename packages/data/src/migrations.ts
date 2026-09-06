/** 手写幂等 DDL，按版本号顺序执行。与 schema.ts 的 drizzle 表定义必须保持一致（repos 测试兜底）。 */
export const MIGRATIONS: { name: string; sql: string }[] = [
  {
    name: "0001_init",
    sql: `
CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('lead','member')),
  token_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  dod TEXT NOT NULL,
  module TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  assignee_member_id TEXT REFERENCES members(id),
  assignee_session_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('draft','claimed','coding','self_review','waiting_review','blocked','done','canceled')),
  blocked_from TEXT,
  conflict_with TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

CREATE TABLE IF NOT EXISTS task_deps (
  task_id TEXT NOT NULL REFERENCES tasks(id),
  depends_on_task_id TEXT NOT NULL REFERENCES tasks(id),
  kind TEXT NOT NULL CHECK (kind IN ('interface','sequence')),
  PRIMARY KEY (task_id, depends_on_task_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id),
  adapter TEXT NOT NULL,
  task_id TEXT REFERENCES tasks(id),
  branch TEXT,
  status TEXT NOT NULL CHECK (status IN ('idle','claimed','coding','self_review','blocked')),
  diff_summary TEXT,
  last_heartbeat_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_member ON sessions(member_id);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('spec','adr','card','reading','agent-doc')),
  path TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  owner TEXT,
  status TEXT NOT NULL DEFAULT 'accepted',
  expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('human','agent','system')),
  actor_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  consumed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_consumed ON events(consumed_at);
`,
  },
  {
    name: "0002_artifact_fts",
    sql: `
CREATE VIRTUAL TABLE IF NOT EXISTS artifact_fts USING fts5(
  path UNINDEXED,
  title,
  tags,
  body,
  tokenize='unicode61'
);
`,
  },
];
