import type { Client } from "@libsql/client";
import type { ArtifactType } from "@superteam/core";
import { dirOfType } from "../model/index.js";

const CJK = /\p{Script=Han}/u;

/**
 * 写入侧归一：unicode61 把「汉字+latin」连写（如 付idempotent）当作一个 token，
 * 因此三类边界都要切开：汉字↔汉字、汉字→latin、latin→汉字。
 */
export function toSearchable(s: string): string {
  return s
    .replace(/(\p{Script=Han})(?=\p{Script=Han})/gu, "$1 ")
    .replace(/(\p{Script=Han})(?=[^\s\p{Script=Han}])/gu, "$1 ")
    .replace(/([^\s\p{Script=Han}])(?=\p{Script=Han})/gu, "$1 ");
}

/** 查询侧：CJK 词组→带引号短语（保序相邻）；latin 词原样；多词 AND。 */
export function buildMatchQuery(text: string): string | null {
  const terms = text
    .trim()
    .split(/\s+/)
    .map((t) => t.replace(/"/g, ""))
    .filter(Boolean);
  if (terms.length === 0) return null;
  return terms
    .map((t) => {
      if (CJK.test(t)) return `"${toSearchable(t).trim()}"`;
      return `"${t}"`;
    })
    .join(" AND ");
}

export interface SearchHit {
  path: string;
  title: string;
  tags: string[];
  snippet: string;
}

export interface SearchQuery {
  text?: string;
  type?: ArtifactType;
  tags?: string[];
  limit?: number;
}

export class SearchService {
  constructor(private client: Client) {}

  async index(path: string, title: string, tags: string[], body: string): Promise<void> {
    // FTS5 虚表不支持 UPSERT，标准做法是 delete-then-insert。
    // title/tags 列存原文（供展示）；检索文本 = title+tags+body 归一后并入 body 列（供中文短语命中）。
    const searchable = toSearchable([title, tags.join(" "), body].filter(Boolean).join("\n"));
    await this.client.execute({ sql: `DELETE FROM artifact_fts WHERE path = ?`, args: [path] });
    await this.client.execute({
      sql: `INSERT INTO artifact_fts (path, title, tags, body) VALUES (?, ?, ?, ?)`,
      args: [path, title, tags.join(" "), searchable],
    });
  }

  async remove(path: string): Promise<void> {
    await this.client.execute({ sql: `DELETE FROM artifact_fts WHERE path = ?`, args: [path] });
  }

  async query(q: SearchQuery): Promise<SearchHit[]> {
    const limit = q.limit ?? 20;
    const match = q.text ? buildMatchQuery(q.text) : null;

    let sql: string;
    const args: (string | number)[] = [];
    if (match) {
      sql = `SELECT path, title, tags, snippet(artifact_fts, 3, '[', ']', '…', 16) AS snip
             FROM artifact_fts WHERE artifact_fts MATCH ?
             ORDER BY rank LIMIT ?`;
      args.push(match, limit);
    } else {
      sql = `SELECT path, title, tags, '' AS snip FROM artifact_fts LIMIT ?`;
      args.push(limit);
    }

    const rs = await this.client.execute({ sql, args });
    const hits: SearchHit[] = [];
    for (const row of rs.rows) {
      const path = String(row["path"]);
      if (q.type && !path.startsWith(`${dirOfType(q.type)}/`)) continue;
      const tagList = String(row["tags"] ?? "").split(/\s+/).filter(Boolean);
      if (q.tags && q.tags.length > 0 && !q.tags.every((t) => tagList.includes(t))) continue;
      hits.push({
        path,
        title: String(row["title"] ?? ""),
        tags: tagList,
        snippet: String(row["snip"] ?? ""),
      });
    }
    return hits;
  }
}
