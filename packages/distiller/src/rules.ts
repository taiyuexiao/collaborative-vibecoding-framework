import type { Event } from "@superteam/core";
import type { KnowledgeRepo } from "@superteam/knowledge";
import type { LlmClient } from "./llm.js";

export interface TaskDoneCardDeps {
  knowledge: KnowledgeRepo;
  llm: LlmClient;
}

const SYSTEM_PROMPT = `你是团队知识管理员。根据给定任务信息，起草一张「经验卡」Markdown 正文（不要 front-matter，只写正文）。
要求：≤300 字；先写「结论」一句话；再写「适用场景」；再写「要点」列表（踩坑/做法/验收心得）。
不要编造任务里不存在的信息。`;

/** 任务 done → LLM 起草经验卡 → propose（actor=agent，Git 留痕待人审）。 */
export function taskDoneCardRule(deps: TaskDoneCardDeps) {
  return {
    name: "task-done-card",
    types: ["task.transitioned"],
    async handle(e: Event): Promise<void> {
      const payload = e.payload as { taskId?: string; to?: string; action?: string };
      if (payload.to !== "done" || !payload.taskId) return;
      // task 快照由 TaskService.transitioned 事件负载携带（S2.2 增强）
      const taskInfo = (e.payload as { task?: { title?: string; dod?: string; description?: string; module?: string | null } }).task;
      if (!taskInfo) return; // 旧格式事件，跳过
      const draft = await deps.llm.complete(
        SYSTEM_PROMPT,
        `任务标题：${taskInfo.title ?? "未知"}\n模块：${taskInfo.module ?? "未分类"}\n验收标准：${taskInfo.dod ?? "无"}\n描述：${taskInfo.description ?? "无"}`,
      );
      await deps.knowledge.propose({
        type: "card",
        title: `【经验】${taskInfo.title}`,
        body: draft,
        tags: ["distilled", ...(taskInfo.module ? [taskInfo.module] : [])],
        owner: null,
        actor: { actorType: "agent", actorId: `distiller(${e.actorId})` },
      });
    },
  };
}
