import { z } from "zod";
import { AppError, type ArtifactType } from "@superteam/core";
import type { KnowledgeRepo } from "@superteam/knowledge";
import type { SearchService, SearchHit } from "@superteam/knowledge";

const MAX_BODY_CHARS = 16_000;

export interface KnowledgeHandlerDeps {
  repo: KnowledgeRepo;
  search: SearchService;
}

export interface KnowledgeHandlers {
  search(args: { text?: string; type?: ArtifactType; tags?: string[]; limit?: number }): Promise<SearchHit[]>;
  read(args: { path: string }): Promise<{
    path: string;
    title: string;
    type: ArtifactType;
    tags: string[];
    owner: string | null;
    status: string;
    expiresAt: string | null;
    body: string;
    truncated: boolean;
  }>;
  propose(args: {
    type: ArtifactType;
    title: string;
    body: string;
    tags?: string[];
    owner?: string;
    status?: string;
    expires?: string;
    actorId?: string;
  }): Promise<{ path: string; sha: string | null }>;
  latest(args?: { n?: number }): Promise<{ path: string; title: string; date: string; message: string }[]>;
}

const SearchArgs = z.object({
  text: z.string().optional(),
  type: z.enum(["spec", "adr", "card", "reading", "agent-doc"]).optional(),
  tags: z.array(z.string()).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

const ReadArgs = z.object({ path: z.string().min(1) });

const ProposeArgs = z.object({
  type: z.enum(["spec", "adr", "card", "reading", "agent-doc"]),
  title: z.string().min(1),
  body: z.string().min(1),
  tags: z.array(z.string()).optional(),
  owner: z.string().optional(),
  status: z.string().optional(),
  expires: z.string().optional(),
  actorId: z.string().default("agent"),
});

const LatestArgs = z.object({ n: z.number().int().min(1).max(50).default(10) });

export function buildKnowledgeHandlers(deps: KnowledgeHandlerDeps): KnowledgeHandlers {
  return {
    async search(args) {
      const q = SearchArgs.parse(args ?? {});
      return deps.search.query(q);
    },

    async read(args) {
      const { path } = ReadArgs.parse(args);
      const { parsed } = await deps.repo.read(path);
      const truncated = parsed.body.length > MAX_BODY_CHARS;
      return {
        path: parsed.path,
        title: parsed.frontmatter.title,
        type: parsed.type,
        tags: parsed.frontmatter.tags,
        owner: parsed.frontmatter.owner ?? null,
        status: parsed.frontmatter.status ?? "accepted",
        expiresAt: parsed.frontmatter.expires ?? null,
        body: truncated ? `${parsed.body.slice(0, MAX_BODY_CHARS)}\n…[截断]` : parsed.body,
        truncated,
      };
    },

    async propose(args) {
      const p = ProposeArgs.parse(args);
      const actor = { actorType: p.actorId === "agent" ? ("agent" as const) : ("human" as const), actorId: p.actorId };
      return deps.repo.propose({
        type: p.type,
        title: p.title,
        body: p.body,
        tags: p.tags,
        owner: p.owner ?? null,
        status: p.status,
        expires: p.expires,
        actor,
      });
    },

    async latest(args) {
      const { n } = LatestArgs.parse(args ?? {});
      const changes = await deps.repo.recentChanges(n * 3);
      const out: { path: string; title: string; date: string; message: string }[] = [];
      for (const c of changes) {
        for (const p of c.paths) {
          if (out.some((e) => e.path === p)) continue;
          let title = p;
          try {
            title = (await deps.repo.read(p)).parsed.frontmatter.title;
          } catch {
            // 文件已被后续提交删除等场景：仍列出路径
          }
          out.push({ path: p, title, date: c.date, message: c.message });
          if (out.length >= n) return out;
        }
      }
      if (out.length === 0) throw new AppError("NOT_FOUND", "知识库暂无提交历史");
      return out;
    },
  };
}
