import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";
import type { ArtifactType } from "@superteam/core";
import { slugify, type ParsedKnowledge } from "../model/index.js";

export interface TocItem {
  level: number;
  text: string;
  slug: string;
}

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkRehype).use(rehypeStringify);

/** 抽取 2-4 级标题生成 TOC；围栏代码块内的 # 不算。slug 复用 slugify，重复标题追加序号。 */
export function extractToc(body: string): TocItem[] {
  const toc: TocItem[] = [];
  let inFence = false;
  const seen = new Map<string, number>();
  for (const line of body.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = /^(#{2,4})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    const level = m[1]!.length;
    const text = m[2]!.trim();
    const base = slugify(text) || "section";
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    toc.push({ level, text, slug: n === 0 ? base : `${base}-${n + 1}` });
  }
  return toc;
}

export function renderMarkdown(body: string): { html: string; toc: TocItem[] } {
  const html = processor.processSync(body).toString();
  return { html, toc: extractToc(body) };
}

export function renderKnowledge(parsed: ParsedKnowledge): {
  html: string;
  toc: TocItem[];
  meta: {
    path: string;
    type: ArtifactType;
    title: string;
    tags: string[];
    owner: string | null | undefined;
    status: string | undefined;
    expiresAt: string | undefined;
    typeMismatch: boolean;
  };
} {
  const { html, toc } = renderMarkdown(parsed.body);
  return {
    html,
    toc,
    meta: {
      path: parsed.path,
      type: parsed.type,
      title: parsed.frontmatter.title,
      tags: parsed.frontmatter.tags,
      owner: parsed.frontmatter.owner ?? null,
      status: parsed.frontmatter.status,
      expiresAt: parsed.frontmatter.expires,
      typeMismatch: parsed.typeMismatch,
    },
  };
}
