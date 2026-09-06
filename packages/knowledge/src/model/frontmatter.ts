import matter from "gray-matter";
import { z } from "zod";
import { AppError, type ArtifactType } from "@superteam/core";

export const KNOWLEDGE_DIRS = ["specs", "adr", "cards", "readings", "agents"] as const;
export type KnowledgeDir = (typeof KNOWLEDGE_DIRS)[number];

const DIR_BY_TYPE: Record<ArtifactType, KnowledgeDir> = {
  spec: "specs",
  adr: "adr",
  card: "cards",
  reading: "readings",
  "agent-doc": "agents",
};

export function dirOfType(t: ArtifactType): KnowledgeDir {
  return DIR_BY_TYPE[t];
}

export function typeOfDir(dir: string): ArtifactType | null {
  for (const [type, d] of Object.entries(DIR_BY_TYPE) as [ArtifactType, KnowledgeDir][]) {
    if (d === dir) return type;
  }
  return null;
}

/** gray-matter 会把 YAML 日期解析成 JS Date；统一转回 YYYY-MM-DD 字符串再校验。 */
const dateishString = (schema: z.ZodString) =>
  z.preprocess((v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v), schema);

export const FrontmatterSchema = z.object({
  title: z.string().min(1, "title 必填"),
  type: z.string().optional(),
  tags: z.array(z.string()).default([]),
  owner: z.string().nullable().optional(),
  created: dateishString(z.string().optional()),
  expires: dateishString(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expires 必须是 YYYY-MM-DD").optional()),
  status: z.string().optional(),
});

export type Frontmatter = z.infer<typeof FrontmatterSchema>;

export interface ParsedKnowledge {
  path: string;
  dir: string;
  type: ArtifactType;
  typeMismatch: boolean;
  frontmatter: Frontmatter;
  body: string;
}

const ADR_STATUSES = ["proposed", "accepted", "superseded"];

export function parseKnowledgeFile(relPath: string, raw: string): ParsedKnowledge {
  const dir = relPath.split("/")[0] ?? "";
  const inferred = typeOfDir(dir);
  if (!inferred) {
    throw new AppError("VALIDATION_FAILED", `未知知识目录：${dir}`, { path: relPath });
  }

  const gm = matter(raw);
  const fm = FrontmatterSchema.safeParse(gm.data);
  if (!fm.success) {
    const issue = fm.error.issues[0];
    throw new AppError(
      "VALIDATION_FAILED",
      `front-matter 校验失败：${issue?.path.join(".")} ${issue?.message ?? ""}`,
      { path: relPath, issues: fm.error.flatten() },
    );
  }

  const declaredType = fm.data.type;
  const typeMismatch = declaredType !== undefined && declaredType !== inferred;
  if (fm.data.status !== undefined && inferred === "adr" && !ADR_STATUSES.includes(fm.data.status)) {
    throw new AppError("VALIDATION_FAILED", `adr status 必须是 ${ADR_STATUSES.join("/")}`, {
      path: relPath,
      got: fm.data.status,
    });
  }

  return {
    path: relPath,
    dir,
    type: inferred,
    typeMismatch,
    frontmatter: fm.data,
    body: gm.content.replace(/^\s*\n/, ""),
  };
}

export function serializeKnowledgeFile(fm: Record<string, unknown>, body: string): string {
  return matter.stringify(body, fm);
}

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^\p{Script=Han}a-z0-9-]/gu, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
