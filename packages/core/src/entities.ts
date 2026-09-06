import { z } from "zod";

export const TASK_STATUSES = [
  "draft",
  "claimed",
  "coding",
  "self_review",
  "waiting_review",
  "blocked",
  "done",
  "canceled",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_ACTIONS = [
  "claim",
  "start",
  "selfReview",
  "submit",
  "requestChanges",
  "approve",
  "block",
  "resume",
  "cancel",
] as const;
export type TaskAction = (typeof TASK_ACTIONS)[number];

export const ARTIFACT_TYPES = ["spec", "adr", "card", "reading", "agent-doc"] as const;
export type ArtifactType = (typeof ARTIFACT_TYPES)[number];

export const ADAPTER_KINDS = ["claude-code", "zcode", "echo"] as const;
export type AdapterKind = (typeof ADAPTER_KINDS)[number];

export const EVENT_TYPES = [
  "task.created",
  "task.transitioned",
  "task.dep_changed",
  "task.conflict_alert",
  "session.registered",
  "session.heartbeat",
  "session.status",
  "artifact.proposed",
  "distill.digest",
  "notify.sent",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const ActorSchema = z.object({
  actorType: z.enum(["human", "agent", "system"]),
  actorId: z.string().min(1),
});
export type Actor = z.infer<typeof ActorSchema>;

export const MemberSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  role: z.enum(["lead", "member"]),
  tokenHash: z.string().min(1),
  createdAt: z.string(),
});
export type Member = z.infer<typeof MemberSchema>;

export const AgentSessionSchema = z.object({
  id: z.string().min(1),
  memberId: z.string().min(1),
  adapter: z.enum(ADAPTER_KINDS),
  taskId: z.string().nullable().default(null),
  branch: z.string().nullable().default(null),
  status: z.enum(["idle", "claimed", "coding", "self_review", "blocked"]),
  diffSummary: z.string().nullable().default(null),
  lastHeartbeatAt: z.string(),
});
export type AgentSession = z.infer<typeof AgentSessionSchema>;

export const TaskSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().default(""),
  dod: z.string().min(1, "DoD（验收标准）必填"),
  module: z.string().nullable().default(null),
  tags: z.array(z.string()).default([]),
  assigneeMemberId: z.string().nullable().default(null),
  assigneeSessionId: z.string().nullable().default(null),
  status: z.enum(TASK_STATUSES).default("draft"),
  blockedFrom: z.enum(TASK_STATUSES).nullable().default(null),
  conflictWith: z.array(z.string()).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Task = z.infer<typeof TaskSchema>;

export const TaskDepSchema = z.object({
  taskId: z.string().min(1),
  dependsOnTaskId: z.string().min(1),
  kind: z.enum(["interface", "sequence"]).default("sequence"),
});
export type TaskDep = z.infer<typeof TaskDepSchema>;

export const ArtifactSchema = z.object({
  id: z.string().min(1),
  type: z.enum(ARTIFACT_TYPES),
  path: z.string().min(1),
  title: z.string().min(1),
  tags: z.array(z.string()).default([]),
  owner: z.string().nullable().default(null),
  status: z.string().default("accepted"),
  expiresAt: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Artifact = z.infer<typeof ArtifactSchema>;

export const EventSchema = z.object({
  id: z.string().min(1),
  type: z.enum(EVENT_TYPES),
  payload: z.unknown(),
  actorType: z.enum(["human", "agent", "system"]),
  actorId: z.string().min(1),
  createdAt: z.string(),
  consumedAt: z.string().nullable().default(null),
});
export type Event = z.infer<typeof EventSchema>;
