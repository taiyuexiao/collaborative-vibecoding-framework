import type { Logger } from "@superteam/infra";

/** 通知出口抽象：飞书群机器人是最小实现；钉钉/Slack 后续实现同一接口。 */
export interface NotifyChannel {
  sendText(text: string): Promise<void>;
  readonly name: string;
}

export class FeishuWebhookChannel implements NotifyChannel {
  readonly name = "feishu-webhook";

  constructor(
    private webhookUrl: string,
    private logger?: Logger,
  ) {}

  async sendText(text: string): Promise<void> {
    const r = await fetch(this.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ msg_type: "text", content: { text } }),
    });
    if (!r.ok) {
      const body = await r.text();
      this.logger?.error({ status: r.status, body: body.slice(0, 200) }, "飞书推送失败");
      throw new Error(`飞书推送失败 HTTP ${r.status}`);
    }
  }
}

/** 未配置 webhook 时的空实现：只记日志，链路不断。 */
export class NullChannel implements NotifyChannel {
  readonly name = "null";

  constructor(private logger?: Logger) {}

  async sendText(text: string): Promise<void> {
    this.logger?.info({ preview: text.slice(0, 120) }, "（未配置通知渠道，仅记录）");
  }
}

export function notifyFromConfig(cfg: { feishuWebhook?: string }, logger?: Logger): NotifyChannel {
  return cfg.feishuWebhook ? new FeishuWebhookChannel(cfg.feishuWebhook, logger) : new NullChannel(logger);
}
