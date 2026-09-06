import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

export interface AgentRunInput {
  prompt: string;
  workdir: string;
}

export interface AgentRunResult {
  exitCode: number;
  output: string;
}

export interface AgentAdapter {
  name: string;
  available(): Promise<boolean>;
  run(input: AgentRunInput): Promise<AgentRunResult>;
}

/** 测试与冒烟用：把 prompt 落成 echo-output.md，模拟 agent 产出。 */
export class EchoAdapter implements AgentAdapter {
  name = "echo";

  async available(): Promise<boolean> {
    return true;
  }

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    const out = [
      "# Echo 产出",
      "",
      "> 本文件由 superteam echo adapter 生成，用于验证任务执行链路。",
      "",
      "## 收到的任务指令",
      "",
      "```",
      input.prompt,
      "```",
    ].join("\n");
    writeFileSync(join(input.workdir, "echo-output.md"), out);
    return { exitCode: 0, output: `echo wrote ${out.length} chars` };
  }
}

/** Claude Code headless：`claude -p <prompt>`，cwd 即 workdir。 */
export class ClaudeCodeAdapter implements AgentAdapter {
  name = "claude-code";

  async available(): Promise<boolean> {
    try {
      await new Promise<void>((resolve, reject) => {
        const p = spawn("claude", ["--version"], { stdio: "ignore" });
        p.on("error", reject);
        p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`exit ${code}`))));
      });
      return true;
    } catch {
      return false;
    }
  }

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    return new Promise((resolve) => {
      const child = spawn("claude", ["-p", input.prompt, "--output-format", "text"], {
        cwd: input.workdir,
        env: process.env,
      });
      let output = "";
      child.stdout?.on("data", (d) => (output += String(d)));
      child.stderr?.on("data", (d) => (output += String(d)));
      child.on("error", (err) => resolve({ exitCode: 127, output: `spawn 失败：${err.message}` }));
      child.on("exit", (code) => resolve({ exitCode: code ?? 1, output }));
    });
  }
}

export function adapterByName(name: string): AgentAdapter {
  if (name === "echo") return new EchoAdapter();
  if (name === "claude-code") return new ClaudeCodeAdapter();
  throw new Error(`未知 adapter：${name}（可用：echo / claude-code）`);
}
