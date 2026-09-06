import type { Event } from "@superteam/core";
import type { EventsRepo } from "@superteam/data";
import type { Logger } from "@superteam/infra";

export interface DistillRule {
  name: string;
  types: string[];
  handle(e: Event): Promise<void>;
}

/** outbox 消费骨架：拉 pending → 按类型分发 → 无论成败 markConsumed（毒丸防护）。 */
export class EventConsumer {
  constructor(
    private events: EventsRepo,
    private logger?: Logger,
  ) {}

  async consumeOnce(rules: DistillRule[]): Promise<number> {
    const pending = await this.events.pending(50);
    const byType = new Map<string, DistillRule[]>();
    for (const rule of rules) {
      for (const t of rule.types) {
        byType.set(t, [...(byType.get(t) ?? []), rule]);
      }
    }
    let processed = 0;
    for (const e of pending) {
      const rulesForType = byType.get(e.type) ?? [];
      for (const rule of rulesForType) {
        try {
          await rule.handle(e);
        } catch (err) {
          // 毒丸防护：失败也消费，避免队列被单条坏事件堵死；完整错误进日志
          this.logger?.error({ err, eventId: e.id, rule: rule.name }, "蒸馏规则执行失败（事件仍标记已消费）");
        }
      }
      await this.events.markConsumed([e.id], new Date().toISOString());
      processed++;
    }
    return processed;
  }
}
