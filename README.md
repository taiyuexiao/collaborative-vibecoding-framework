# Collaborative Vibe-Coding Framework

**Multi-Person Collaborative Vibe-Coding Framework（多人协作 vibecoding 框架）** —— 项目代号「共工 GongGong」。

> Let humans manage the work; let agents absorb the coordination overhead.
> 让人管理工作，让 agent 消化协作开销。

[中文说明](#中文说明) · [Roadmap](docs/ROADMAP.md) · [PRD](docs/PRD.md) · [Tech Design](docs/TECH.md)

## Why

Single person + a fleet of coding agents (a.k.a. vibe coding) works well today. But when a task outgrows one person, teams hit a wall:

- **Knowledge lives in agents, not people.** Cross-human communication degrades to copy-pasting agent outputs in IM groups.
- **Instructions evaporate** in group chats; specs and mentor guidance are re-explained to agents over and over.
- **Conflicts surface at merge time** — parallel agents step on each other's files and interfaces.
- **Experience evaporates** when a member leaves; onboarding a new engineer takes months.

共工 is a **team operating layer** under which every engineer leads their own agent fleet: a task bus with a shared state machine, a Git-backed knowledge archive both humans and agents read, a conflict radar, and a distiller that turns collaboration debris into durable knowledge.

## What it does

| Layer | Capability |
|---|---|
| Task Bus | Kanban + REST issues with mandatory DoD, a shared human/agent state machine, dependency graph with cycle detection, outbox events |
| Agent Bridge | Per-machine daemon: claims tasks → isolated git worktree → assembles prompt (task + DoD + specs + experience cards + AGENTS.md) → drives your coding agent (Claude Code / adapters) → diff summary reported back |
| Conflict Radar | File-overlap alerts between in-flight branches; contract-change (specs/) notifications to all downstream task owners |
| Knowledge Archive | Five typed knowledge objects (spec / ADR / card / reading / agent-doc) in a Git repo — humans see a docs site, agents query via **MCP** (`search / read / propose / latest`) |
| Distiller | Outbox consumer: completed task → LLM-drafted experience card (template fallback without an LLM key); daily digest |
| Notify | Feishu webhook channel (DingTalk/Slack same interface) |

## Architecture

```
入口层   飞书/IM（通知+轻指令）        IDE/CLI（zcode、Claude Code、Codex…）
              │                              │
流层     话题化讨论流（digest 聚合，对抗信息轰炸）
              │  distiller：流 → 档（AI 起草 + 人审合入）
档案层   Git 仓库 = 唯一事实源（specs / adr / cards / readings / agents）
              │  MCP server（search/read/propose/latest）
任务层   看板（状态机）──事件 outbox──▶ 雷达（冲突预警）──▶ 蒸馏器（知识沉淀）
              │
执行层   daemon（每台成员机器）：认领 → worktree → 驱动本地 coding agent → 回写
```

## Quickstart

```bash
pnpm install
pnpm test          # 106 unit/integration tests
pnpm dev           # server + web UI on http://127.0.0.1:7300
pnpm seed          # optional: load demo data

# let agents read/write the team knowledge base (zcode / Claude Code MCP config):
pnpm mcp           # stdio MCP server: search / read / propose / latest

# run an executor on your machine (claims tasks and drives your local coding agent):
pnpm daemon -- --server http://127.0.0.1:7300 --token <member-token> --repo <task-repo-path> --adapter claude-code
```

Full feature sweep: `npx tsx scripts/e2e-full.ts` (43 end-to-end checks incl. MCP stdio handshake, WS broadcast, daemon chain, radar & distiller loops).

## Tech stack

TypeScript monorepo · Fastify + WebSocket · Drizzle + SQLite (Postgres-compatible schema) · React + Vite · MCP SDK · vitest.

## Repository layout

```
docs/            PRD / TECH / PLAN / ROADMAP / per-submodule SDD records
packages/
  core/          domain model + task state machine (shared by server & web)
  infra/ data/ gitprov/        config, SQLite repos, GitProvider (local impl; Gitee/GitHub pluggable)
  knowledge/     typed knowledge objects, FTS5 search (CJK-aware), markdown render
  tasks/ server/ daemon/ mcp/ web/ radar/ distiller/
scripts/         seed-demo.ts · e2e-full.ts · onboard-aep.ts (real-project importer)
```

Every submodule carries its own `SDD.md` (spec-first development log: goal, route, interface, **errors & fixes**).

## 中文说明

共工是一个给「人 + 各自带 agent 团队的成员」使用的团队协作操作系统：任务总线（状态机 + 依赖图 + 看板）、会话桥（把每个成员本地的 coding agent 接进同一工作面）、冲突雷达（文件重叠与契约变更预警）、知识档案（人读文档站 = agent 读 Git 仓库，MCP 四工具接入）与蒸馏器（把任务/讨论自动沉淀为经验卡）。设计原则：不窥视 agent 大脑（只交换工件与状态）、agent 间窄接口而非自由对话、propose 必人审、一切以 Git 仓库为唯一事实源。设计依据与产业调研见 [docs/PRD.md](docs/PRD.md) 与 [docs/ROADMAP.md](docs/ROADMAP.md)。

## Roadmap

See [docs/ROADMAP.md](docs/ROADMAP.md) — P0: Gitee PR round-trip, atomic task claiming, ready-queue + DAG view, IM two-way entry, knowledge-by-reference. P1: distributed radar, agent progress streaming, per-person digests, hybrid retrieval.

## License

MIT
