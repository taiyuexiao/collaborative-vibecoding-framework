export interface LlmClient {
  complete(system: string, user: string): Promise<string>;
}

export interface OpenAiLlmOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
}

/** OpenAI 兼容 /chat/completions（GLM 等网关均兼容）。 */
export class OpenAiCompatLlm implements LlmClient {
  private fetchImpl: typeof fetch;

  constructor(private o: OpenAiLlmOptions) {
    this.fetchImpl = o.fetchImpl ?? fetch;
  }

  async complete(system: string, user: string): Promise<string> {
    const r = await this.fetchImpl(`${this.o.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.o.apiKey}` },
      body: JSON.stringify({
        model: this.o.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.3,
      }),
    });
    if (!r.ok) {
      throw new Error(`LLM 请求失败 HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
    }
    const data = (await r.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("LLM 返回为空");
    return content;
  }
}

/** 未配置 LLM 时的确定性降级：模板起草，保证蒸馏链路不断。 */
export class NullLlm implements LlmClient {
  async complete(_system: string, user: string): Promise<string> {
    return `> ⚠️ 未配置 LLM，以下为模板占位草稿，请人工补全。\n\n${user}`;
  }
}

export function llmFromConfig(cfg: { llmBaseUrl?: string; llmApiKey?: string; llmModel: string }): LlmClient {
  if (cfg.llmBaseUrl && cfg.llmApiKey) {
    return new OpenAiCompatLlm({ baseUrl: cfg.llmBaseUrl, apiKey: cfg.llmApiKey, model: cfg.llmModel });
  }
  return new NullLlm();
}
