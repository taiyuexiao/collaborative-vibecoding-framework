/**
 * AEP（异构智能体测评平台）项目接入脚本（全新实例专用）：
 * 队长注册（token 存 data/.lead-token）→ 团队成员 → 项目文档入库 → 53 项任务 → 依赖图（最长标题贪心匹配）。
 * 运行：npx tsx scripts/onboard-aep.ts
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";

const SERVER = process.env["SUPERTEAM_SERVER"] ?? "http://127.0.0.1:7300";
const TOKEN_FILE = "data/.lead-token";
const plan = JSON.parse(readFileSync("/tmp/aep-onboard/plan.json", "utf8")) as {
  members: string[];
  tasks: { module: string; title: string; owners: string[]; upstream: string[] }[];
  docs: Record<string, string>;
};
const AEP_DOCS = "/tmp/aep-onboard/team-doc/aep";
const REPO = "/Users/spl/projects/aep/agent-evaluation-platform";

async function req<T>(method: string, path: string, body?: unknown, token?: string): Promise<T> {
  const r = await fetch(`${SERVER}/api/v1${path}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await r.json()) as { error?: { message?: string } };
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}: ${data?.error?.message ?? ""}`);
  return data as T;
}

function cleanMd(s: string): string {
  return s.replace(/\\([._()#*])/g, "$1").slice(0, 14000);
}

/** 上游依赖单元格解析：优先整格精确匹配；否则贪心匹配最长已知标题（兼容标题自身含「、」）。 */
export function matchUpstreams(cell: string, titles: Set<string>): { matched: string[]; unmatched: string[] } {
  const trimmed = cell.trim();
  if (titles.has(trimmed)) return { matched: [trimmed], unmatched: [] };
  const matched: string[] = [];
  let s = trimmed;
  let progress = true;
  while (progress) {
    progress = false;
    const candidates = [...titles].filter((t) => s.includes(t)).sort((a, b) => b.length - a.length);
    if (candidates[0]) {
      matched.push(candidates[0]!);
      s = s.replace(candidates[0]!, "，");
      progress = true;
    }
  }
  const leftover = s.replace(/[，,、—\s]/g, "");
  return { matched, unmatched: leftover ? [leftover] : [] };
}

async function main() {
  // 0. 队长
  mkdirSync("data", { recursive: true });
  let leadToken: string;
  if (existsSync(TOKEN_FILE)) {
    leadToken = readFileSync(TOKEN_FILE, "utf8").trim();
  } else {
    leadToken = (await req<{ token: string }>("POST", "/members", { name: "aep-lead", role: "lead" })).token;
    writeFileSync(TOKEN_FILE, leadToken);
  }
  const T = leadToken;

  // 1. 团队成员
  const nameToId = new Map<string, string>();
  for (const name of plan.members) {
    try {
      const m = await req<{ member: { id: string } }>("POST", "/members", { name, role: "member" });
      nameToId.set(name, m.member.id);
    } catch {
      const list = await req<{ id: string; name: string }[]>("GET", "/members");
      const found = list.find((x) => x.name === name);
      if (found) nameToId.set(name, found.id);
    }
  }
  console.log(`✓ 成员：管理员 1 + 团队 ${nameToId.size}/${plan.members.length}`);

  // 2. 项目文档入库
  const docs: { type: "spec" | "reading" | "agent-doc"; title: string; body: string; tags: string[] }[] = [
    { type: "spec", title: "01 需求说明", body: cleanMd(readFileSync(`${AEP_DOCS}/01_需求说明文档.md`, "utf8")), tags: ["需求", "P0"] },
    { type: "spec", title: "02 产品设计", body: cleanMd(plan.docs["产品设计"]!), tags: ["设计", "P0"] },
    { type: "spec", title: "04 需求与功能拆分", body: cleanMd(plan.docs["功能拆分"]!), tags: ["设计", "拆分", "P0"] },
    { type: "reading", title: "05 需求对照 Gap 分析（01 vs 04）", body: "## 出处\n需求包 05 文档。\n\n## 摘要\n" + cleanMd(readFileSync(`${AEP_DOCS}/05_01与04需求对照Gap分析.md`, "utf8")), tags: ["gap", "需求"] },
    { type: "reading", title: "07 P0-06 需求对照 Gap 分析", body: "## 出处\n需求包 07 文档。\n\n## 摘要\n" + cleanMd(readFileSync(`${AEP_DOCS}/07_P0-06需求对照Gap分析.md`, "utf8")), tags: ["gap", "评分"] },
    { type: "reading", title: "06 RFC 风险与未解决问题详解", body: "## 出处\n需求包 06 文档。\n\n## 摘要\n" + cleanMd(readFileSync(`${AEP_DOCS}/06_RFC风险与未解决问题详解.md`, "utf8")), tags: ["风险", "rfc"] },
    { type: "agent-doc", title: "AEP 仓库 AGENTS.md（快照）", body: readFileSync(`${REPO}/AGENTS.md`, "utf8"), tags: ["agents", "规范"] },
  ];
  for (const d of docs) {
    await req("POST", "/artifacts/propose", { ...d, owner: "aep-lead", actorId: "aep-lead" }, T);
  }
  console.log(`✓ 知识入库：${docs.length} 篇（spec 3 / reading 3 / agent-doc 1）`);

  // 3. 任务
  const titleToId = new Map<string, string>();
  for (const t of plan.tasks) {
    let created: { id: string };
    try {
      created = await req<{ id: string }>("POST", "/tasks", {
        title: t.title,
        description: `所属模块：${t.module}。负责人：${t.owners.join("、") || "待定（P0-01 依赖 MVP 角色确认）"}。`,
        dod: `按仓库 docs/交付流程.md 四道闸完成交付；实现与 specs/ 对应需求条目一致；上游依赖任务全部合入。`,
        module: t.module.split("｜")[0],
        tags: [t.module, ...t.owners.map((o) => `@${o}`)],
        assigneeMemberId: t.owners[0] ? nameToId.get(t.owners[0]) ?? null : null,
      }, T);
    } catch (e) {
      throw new Error(`任务「${t.title}」创建失败：${(e as Error).message}`);
    }
    titleToId.set(t.title, created.id);
  }
  console.log(`✓ 任务：${titleToId.size}/${plan.tasks.length} 项创建`);

  // 4. 依赖图（贪心匹配，兼容标题含「、」）
  let edges = 0;
  const unresolved = new Set<string>();
  for (const t of plan.tasks) {
    if (t.upstream.length === 0) continue;
    const deps: { dependsOnTaskId: string; kind: "interface" | "sequence" }[] = [];
    for (const cell of t.upstream) {
      const { matched, unmatched } = matchUpstreams(cell, new Set(titleToId.keys()));
      for (const m of matched) deps.push({ dependsOnTaskId: titleToId.get(m)!, kind: "sequence" });
      for (const u of unmatched) unresolved.add(u);
    }
    if (deps.length > 0) {
      await req("PUT", `/tasks/${titleToId.get(t.title)!}/deps`, { deps }, T);
      edges += deps.length;
    }
  }
  console.log(`✓ 依赖边：${edges} 条${unresolved.size ? `；未匹配片段：${[...unresolved].join("、")}` : "，全部匹配"}`);

  // 5. 抽查
  const sample = await req<{ status: string; deps?: unknown[] }>("GET", `/tasks/${titleToId.get("发布评测集版本")!}`);
  console.log(`✓ 抽查「发布评测集版本」：状态 ${sample.status}，上游 ${sample.deps?.length ?? 0} 条`);
  const gate = await req<{ deps?: unknown[] }>("GET", `/tasks/${titleToId.get("执行交付安全检查")!}`);
  console.log(`✓ 抽查「执行交付安全检查」：上游 ${gate.deps?.length ?? 0} 条（含含「、」标题的边）`);
  console.log("\n接入完成。看板地址：http://127.0.0.1:7300/");
}

main().catch((e) => {
  console.error("接入失败：", e.message);
  process.exit(1);
});
