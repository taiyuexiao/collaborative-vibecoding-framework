import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, basename, join } from "node:path";
import { realpathSync } from "node:fs";
import { promisify } from "node:util";
import { AppError } from "@superteam/core";

const exec = promisify(execFile);

export interface CommitInfo {
  sha: string;
  message: string;
  date: string;
  author: string;
}

export interface CommitWithFiles {
  sha: string;
  date: string;
  message: string;
  paths: string[];
}

/** 仓库操作抽象。Local 实现面向本地 git CLI；远端托管（Gitee）后续实现同一接口。 */
export interface GitProvider {
  isRepo(dir: string): Promise<boolean>;
  ensureRepo(dir: string, opts?: { defaultBranch?: string }): Promise<void>;
  /** 全部改动（含未跟踪）提交；无改动返回 null。 */
  commitAll(dir: string, message: string): Promise<string | null>;
  /** 仅提交指定文件；无改动返回 null。 */
  commitFiles(dir: string, files: string[], message: string): Promise<string | null>;
  currentBranch(dir: string): Promise<string>;
  /** worktree 已存在则跳过。 */
  ensureWorktree(repoDir: string, worktreePath: string, branch: string): Promise<void>;
  removeWorktree(repoDir: string, worktreePath: string): Promise<void>;
  /** 工作区（含 worktree）内相对 baseBranch 的改动文件清单（merge-base 三点 diff）。 */
  changedFiles(dir: string, baseBranch: string): Promise<string[]>;
  log(dir: string, opts?: { n?: number; path?: string }): Promise<CommitInfo[]>;
  logWithFiles(dir: string, n?: number): Promise<CommitWithFiles[]>;
  revParse(dir: string, ref: string): Promise<string>;
}

async function run(cwd: string, cmd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await exec("git", [cmd, ...args], { cwd, maxBuffer: 16 * 1024 * 1024 });
    return stdout;
  } catch (err) {
    const e = err as { stderr?: string; message: string };
    throw new AppError("CONFLICT", `git ${cmd} 失败：${(e.stderr ?? e.message).trim().slice(0, 500)}`, {
      cmd: `git ${cmd} ${args.join(" ")}`,
      cwd,
    });
  }
}

function firstLine(s: string): string {
  return s.trim().split("\n")[0] ?? "";
}

/** 尽力而为的真实路径：已存在取 realpath；不存在（如尚未创建的 worktree）取父目录 realpath 拼接 basename。 */
function bestEffortRealpath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    try {
      return join(realpathSync(dirname(p)), basename(p));
    } catch {
      return p;
    }
  }
}

export class LocalGitProvider implements GitProvider {
  async isRepo(dir: string): Promise<boolean> {
    try {
      await run(dir, "rev-parse", ["--is-inside-work-tree"]);
      return true;
    } catch {
      return false;
    }
  }

  async ensureRepo(dir: string, opts?: { defaultBranch?: string }): Promise<void> {
    mkdirSync(dir, { recursive: true }); // ensure 语义：目录不存在则创建（git init 需要已存在的 cwd）
    // 必须判断 dir 自身是仓库根（toplevel），而非"位于某个仓库内"——否则嵌套目录（如项目内的 knowledge/）
    // 会因外层仓库误判为已是仓库而跳过 init，后续 add/commit 全部落到外层仓库。
    let isTop = false;
    try {
      const top = await run(dir, "rev-parse", ["--show-toplevel"]);
      isTop = bestEffortRealpath(top.trim()) === bestEffortRealpath(dir);
    } catch {
      isTop = false; // 不在任何仓库内
    }
    if (!isTop) {
      await run(dir, "init", ["-b", opts?.defaultBranch ?? "main"]);
    }
    // 空仓库（无任何提交）时 main 分支 unborn，merge-base/worktree 会失败——补一个空提交保证 HEAD 存在
    try {
      await run(dir, "rev-parse", ["--verify", "HEAD"]);
    } catch {
      await run(dir, "commit", ["--allow-empty", "-m", "init"]);
    }
    // 仓库级身份：无全局配置的机器也能 commit；不覆盖用户已有配置
    try {
      await run(dir, "config", ["user.name"]);
    } catch {
      await run(dir, "config", ["user.name", "superteam"]);
      await run(dir, "config", ["user.email", "superteam@local"]);
    }
  }

  private async hasStagedOrDirty(dir: string): Promise<boolean> {
    const out = await run(dir, "status", ["--porcelain"]);
    return out.trim().length > 0;
  }

  async commitAll(dir: string, message: string): Promise<string | null> {
    await run(dir, "add", ["-A"]);
    if (!(await this.hasStagedOrDirty(dir))) return null;
    await run(dir, "commit", ["-m", message, "--allow-empty"]);
    return firstLine(await run(dir, "rev-parse", ["HEAD"]));
  }

  async commitFiles(dir: string, files: string[], message: string): Promise<string | null> {
    if (files.length === 0) return null;
    await run(dir, "add", ["--", ...files]);
    if (!(await this.hasStagedOrDirty(dir))) return null;
    await run(dir, "commit", ["-m", message]);
    return firstLine(await run(dir, "rev-parse", ["HEAD"]));
  }

  async currentBranch(dir: string): Promise<string> {
    return firstLine(await run(dir, "branch", ["--show-current"]));
  }

  async ensureWorktree(repoDir: string, worktreePath: string, branch: string): Promise<void> {
    // macOS 下 /var/folders 是符号链接，git porcelain 返回解析后的真实路径，必须按 realpath 比对
    const requested = bestEffortRealpath(worktreePath);
    const list = await run(repoDir, "worktree", ["list", "--porcelain"]);
    const exists = list
      .split("\n")
      .some((l) => l.startsWith("worktree ") && bestEffortRealpath(l.slice("worktree ".length)) === requested);
    if (exists) return;
    const branches = await run(repoDir, "branch", ["--list", branch]);
    if (branches.trim()) {
      await run(repoDir, "worktree", ["add", worktreePath, branch]);
    } else {
      await run(repoDir, "worktree", ["add", "-b", branch, worktreePath]);
    }
  }

  async removeWorktree(repoDir: string, worktreePath: string): Promise<void> {
    await run(repoDir, "worktree", ["remove", worktreePath, "--force"]);
  }

  async changedFiles(dir: string, baseBranch: string): Promise<string[]> {
    const base = firstLine(await run(dir, "merge-base", [baseBranch, "HEAD"]));
    const out = await run(dir, "diff", ["--name-only", base, "HEAD"]);
    // 加上未提交改动
    const dirty = await run(dir, "diff", ["--name-only"]);
    const untracked = await run(dir, "ls-files", ["--others", "--exclude-standard"]);
    const all = new Set<string>();
    for (const chunk of [out, dirty, untracked]) {
      for (const line of chunk.split("\n")) {
        const f = line.trim();
        if (f) all.add(f);
      }
    }
    return [...all].sort();
  }

  async log(dir: string, opts?: { n?: number; path?: string }): Promise<CommitInfo[]> {
    const n = opts?.n ?? 20;
    const args = ["-n", String(n), "--pretty=format:%H%x1f%ad%x1f%an%x1f%s", "--date=iso-strict"];
    if (opts?.path) args.push("--", opts.path);
    const out = await run(dir, "log", ...[args]);
    return out
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [sha, date, author, ...rest] = line.split("\x1f");
        return { sha: sha ?? "", date: date ?? "", author: author ?? "", message: rest.join("\x1f") };
      });
  }

  /** 提交日志及其变更文件清单。分隔符 %x1e 放在记录开头：这样 \x1e 后的 chunk = 头 + 本记录的文件列表。 */
  async logWithFiles(dir: string, n = 20): Promise<CommitWithFiles[]> {
    const out = await run(dir, "log", [
      "-n",
      String(n),
      "--name-only",
      "--pretty=format:%x1e%H%x1f%ad%x1f%s",
      "--date=iso-strict",
    ]);
    return out
      .split("\x1e")
      .map((c) => c.replace(/^\n/, ""))
      .filter(Boolean)
      .map((chunk) => {
        const lines = chunk.split("\n").filter(Boolean);
        const [sha, date, message] = (lines[0] ?? "").split("\x1f");
        return {
          sha: sha ?? "",
          date: date ?? "",
          message: message ?? "",
          paths: lines.slice(1).filter(Boolean),
        };
      });
  }

  async revParse(dir: string, ref: string): Promise<string> {
    return firstLine(await run(dir, "rev-parse", [ref]));
  }
}
