import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  ArtifactsRepo,
  DepsRepo,
  EventsRepo,
  MembersRepo,
  SessionsRepo,
  TasksRepo,
  createDb,
  type Db,
} from "@superteam/data";
import { LocalGitProvider, type GitProvider } from "@superteam/gitprov";
import type { SuperteamConfig } from "@superteam/infra";
import { KnowledgeRepo } from "@superteam/knowledge";
import { SearchService } from "@superteam/knowledge";
import { TaskService } from "@superteam/tasks";
import { DigestService, llmFromConfig, type LlmClient } from "@superteam/distiller";
import { notifyFromConfig, type NotifyChannel } from "./notify.js";

export interface Context {
  config: SuperteamConfig;
  db: Db;
  members: MembersRepo;
  tasks: TasksRepo;
  deps: DepsRepo;
  events: EventsRepo;
  artifacts: ArtifactsRepo;
  sessions: SessionsRepo;
  git: GitProvider;
  search: SearchService;
  knowledge: KnowledgeRepo;
  taskService: TaskService;
  digest: DigestService;
  llm: LlmClient;
  notify: NotifyChannel;
  sockets: Set<unknown>;
}

export async function createContext(config: SuperteamConfig): Promise<Context> {
  mkdirSync(config.dataDir, { recursive: true }); // SQLITE_CANTOPEN 防御：库文件所在目录必须先存在
  const db = await createDb(join(config.dataDir, "superteam.db"));
  const git = new LocalGitProvider();
  const search = new SearchService(db.client);
  const llm = llmFromConfig(config);
  const notify = notifyFromConfig(config);
  const knowledge = new KnowledgeRepo({
    knowledgeDir: config.knowledgeDir,
    git,
    artifacts: new ArtifactsRepo(db.db),
    events: new EventsRepo(db.db),
    indexer: search,
  });
  return {
    config,
    db,
    members: new MembersRepo(db.db),
    tasks: new TasksRepo(db.db),
    deps: new DepsRepo(db.db),
    events: new EventsRepo(db.db),
    artifacts: new ArtifactsRepo(db.db),
    sessions: new SessionsRepo(db.db),
    git,
    search,
    knowledge,
    taskService: new TaskService({
      tasks: new TasksRepo(db.db),
      deps: new DepsRepo(db.db),
      events: new EventsRepo(db.db),
    }),
    digest: new DigestService({ events: new EventsRepo(db.db), tasks: new TasksRepo(db.db) }),
    llm,
    notify,
    sockets: new Set<unknown>(),
  };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newToken(): string {
  return createHash("sha256")
    .update(`${Date.now()}-${Math.random()}-${process.pid}`)
    .digest("hex")
    .slice(0, 40);
}
