import { mkdirSync, readdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
  AppError,
  newId,
  type Actor,
  type Artifact,
  type ArtifactType,
} from "@superteam/core";
import type { ArtifactsRepo, EventsRepo } from "@superteam/data";
import type { CommitInfo, CommitWithFiles, GitProvider } from "@superteam/gitprov";
import type { Logger } from "@superteam/infra";
import {
  KNOWLEDGE_DIRS,
  dirOfType,
  parseKnowledgeFile,
  serializeKnowledgeFile,
  slugify,
  type ParsedKnowledge,
} from "../model/index.js";

export interface ProposeInput {
  type: ArtifactType;
  title: string;
  body: string;
  tags?: string[];
  owner?: string | null;
  status?: string;
  expires?: string;
  actor: Actor;
}

export interface KnowledgeIndexer {
  index(path: string, title: string, tags: string[], body: string): Promise<void> | void;
  remove(path: string): Promise<void> | void;
}

export interface KnowledgeRepoDeps {
  knowledgeDir: string;
  git: GitProvider;
  artifacts: ArtifactsRepo;
  events?: EventsRepo;
  indexer?: KnowledgeIndexer;
  logger?: Logger;
}

export class KnowledgeRepo {
  constructor(private o: KnowledgeRepoDeps) {}

  async ensureScaffold(): Promise<void> {
    await this.o.git.ensureRepo(this.o.knowledgeDir);
    for (const d of KNOWLEDGE_DIRS) {
      const p = join(this.o.knowledgeDir, d);
      mkdirSync(p, { recursive: true });
      const keep = join(p, ".gitkeep");
      if (!existsSync(keep)) writeFileSync(keep, "");
    }
    await this.o.git.commitAll(this.o.knowledgeDir, "knowledge: scaffold");
  }

  private allKnowledgeFiles(): string[] {
    const out: string[] = [];
    for (const d of KNOWLEDGE_DIRS) {
      const abs = join(this.o.knowledgeDir, d);
      if (!existsSync(abs)) continue;
      const walk = (p: string) => {
        for (const e of readdirSync(p, { withFileTypes: true })) {
          if (e.isDirectory()) walk(join(p, e.name));
          else if (e.isFile() && e.name.endsWith(".md")) out.push(relative(this.o.knowledgeDir, join(p, e.name)));
        }
      };
      walk(abs);
    }
    return out.sort();
  }

  /** 全量扫描：文件 → db 索引 + 检索钩子；坏文件跳过并告警；清除已删除文件的残留行。 */
  async scan(): Promise<Artifact[]> {
    const results: Artifact[] = [];
    const seenPaths = new Set<string>();
    for (const rel of this.allKnowledgeFiles()) {
      try {
        const parsed = parseKnowledgeFile(rel, readFileSync(join(this.o.knowledgeDir, rel), "utf8"));
        const artifact = this.toArtifact(parsed);
        await this.o.artifacts.upsert(artifact);
        await this.o.indexer?.index(artifact.path, artifact.title, artifact.tags, parsed.body);
        seenPaths.add(rel);
        results.push(artifact);
      } catch (err) {
        this.o.logger?.warn({ err, path: rel }, "scan: 跳过无法解析的知识文件");
      }
    }
    // 清除残留
    const stale = (await this.o.artifacts.list()).filter(
      (a) => !seenPaths.has(a.path) && KNOWLEDGE_DIRS.some((d) => a.path.startsWith(`${d}/`)),
    );
    for (const a of stale) {
      await this.o.artifacts.removeByPath(a.path);
      await this.o.indexer?.remove(a.path);
    }
    return results;
  }

  async read(path: string): Promise<{ parsed: ParsedKnowledge; raw: string }> {
    const abs = join(this.o.knowledgeDir, path);
    if (!existsSync(abs)) {
      throw new AppError("NOT_FOUND", `知识文件不存在：${path}`);
    }
    const raw = readFileSync(abs, "utf8");
    return { parsed: parseKnowledgeFile(path, raw), raw };
  }

  async propose(input: ProposeInput): Promise<{ path: string; sha: string | null }> {
    const rel = await this.filePathFor(input);
    const existing = existsSync(join(this.o.knowledgeDir, rel));
    const prevCreated = existing
      ? (() => {
          try {
            return parseKnowledgeFile(rel, readFileSync(join(this.o.knowledgeDir, rel), "utf8")).frontmatter.created;
          } catch {
            return undefined;
          }
        })()
      : undefined;

    const fm: Record<string, unknown> = {
      title: input.title,
      type: input.type,
      tags: input.tags ?? [],
      owner: input.owner ?? null,
      created: prevCreated ?? new Date().toISOString().slice(0, 10),
    };
    if (input.expires) fm["expires"] = input.expires;
    if (input.status) fm["status"] = input.status;

    writeFileSync(join(this.o.knowledgeDir, rel), serializeKnowledgeFile(fm, input.body));
    const msg = `knowledge(propose): [${input.type}] ${input.title} — ${input.actor.actorId}(${input.actor.actorType})`;
    const sha = await this.o.git.commitFiles(this.o.knowledgeDir, [rel], msg);

    const parsed = parseKnowledgeFile(rel, readFileSync(join(this.o.knowledgeDir, rel), "utf8"));
    const artifact = this.toArtifact(parsed);
    await this.o.artifacts.upsert(artifact);
    await this.o.indexer?.index(artifact.path, artifact.title, artifact.tags, parsed.body);
    await this.o.events?.append({
      id: newId("ev"),
      type: "artifact.proposed",
      payload: { path: rel, type: input.type, title: input.title, actor: input.actor },
      actorType: input.actor.actorType,
      actorId: input.actor.actorId,
      createdAt: new Date().toISOString(),
      consumedAt: null,
    });
    return { path: rel, sha };
  }

  async history(path: string): Promise<CommitInfo[]> {
    return this.o.git.log(this.o.knowledgeDir, { path, n: 50 });
  }

  /** 仓库级最近变更（含文件清单），供 MCP latest 使用。 */
  async recentChanges(n = 10): Promise<CommitWithFiles[]> {
    return this.o.git.logWithFiles(this.o.knowledgeDir, n);
  }

  /** 类型化路径策略：adr 自动编号；card/reading 日期前缀；spec/agent-doc 同 slug 复用更新。 */
  private async filePathFor(input: ProposeInput): Promise<string> {
    const dir = dirOfType(input.type);
    const slug = slugify(input.title) || "untitled";
    const today = new Date().toISOString().slice(0, 10);
    if (input.type === "adr") {
      const existing = this.allKnowledgeFiles().filter((p) => p.startsWith("adr/"));
      let max = 0;
      for (const p of existing) {
        const m = /(?:^|\/)(\d{4})-/.exec(p);
        if (m) max = Math.max(max, Number(m[1]));
      }
      return `adr/${String(max + 1).padStart(4, "0")}-${slug}.md`;
    }
    if (input.type === "card" || input.type === "reading") {
      return `${dir}/${today}-${slug}.md`;
    }
    return `${dir}/${slug}.md`;
  }

  private toArtifact(parsed: ParsedKnowledge): Artifact {
    const now = new Date().toISOString();
    return {
      id: newId("af"),
      type: parsed.type,
      path: parsed.path,
      title: parsed.frontmatter.title,
      tags: parsed.frontmatter.tags,
      owner: parsed.frontmatter.owner ?? null,
      status: parsed.frontmatter.status ?? "accepted",
      expiresAt: parsed.frontmatter.expires ?? null,
      createdAt: now,
      updatedAt: now,
    };
  }
}
