import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LocalGitProvider } from "./local.js";

let dir: string;
const git = new LocalGitProvider();
const worktree = () => join(dir, "wt-task");

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "st-git-"));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("LocalGitProvider", () => {
  it("ensureRepo 幂等并注入仓库级身份", async () => {
    await git.ensureRepo(dir);
    expect(await git.isRepo(dir)).toBe(true);
    await git.ensureRepo(dir); // 再跑一次不炸
  });

  it("commitAll：有改动返回 sha，无改动返回 null", async () => {
    writeFileSync(join(dir, "a.md"), "hello");
    const sha = await git.commitAll(dir, "init a");
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    expect(await git.commitAll(dir, "empty commit")).toBeNull();
  });

  it("commitFiles 只提交指定文件", async () => {
    writeFileSync(join(dir, "b.md"), "b");
    writeFileSync(join(dir, "c.md"), "c");
    const sha = await git.commitFiles(dir, ["b.md"], "only b");
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    const dirty = await git.commitFiles(dir, ["c.md"], "nothing staged yet c");
    expect(dirty).toMatch(/^[0-9a-f]{40}$/);
  });

  it("ensureWorktree 幂等；worktree 内提交对主仓库可见", async () => {
    await git.ensureWorktree(dir, worktree(), "task/demo");
    await git.ensureWorktree(dir, worktree(), "task/demo"); // 幂等
    expect(await git.currentBranch(worktree())).toBe("task/demo");

    writeFileSync(join(worktree(), "task.txt"), "work");
    await git.commitAll(worktree(), "task work");
    const onBranch = await git.revParse(worktree(), "HEAD");
    // worktree 与主仓库共享对象库：main 的 log 不含任务分支提交，但分支引用可见
    expect(await git.revParse(dir, "refs/heads/task/demo")).toBe(onBranch);
    expect((await git.log(dir, { n: 5 })).some((c) => c.sha === onBranch)).toBe(false);

    await git.removeWorktree(dir, worktree());
  });

  it("changedFiles：merge-base 三点 diff + 未提交改动（在任务分支/worktree 上）", async () => {
    const wt = join(dir, "wt-diff");
    await git.ensureWorktree(dir, wt, "task/diff");
    // worktree 相对 main 已有的差异（分支创建后新增的提交）+ 未提交改动都应列出
    writeFileSync(join(wt, "d.md"), "committed");
    await git.commitAll(wt, "commit d");
    writeFileSync(join(wt, "e.md"), "dirty");
    const files = await git.changedFiles(wt, "main");
    expect(files).toContain("d.md");
    expect(files).toContain("e.md"); // 未提交也算在途
    await git.removeWorktree(dir, wt);
  });

  it("log 支持 path 过滤与数量限制", async () => {
    const log = await git.log(dir, { n: 2 });
    expect(log.length).toBeLessThanOrEqual(2);
    const logA = await git.log(dir, { path: "a.md" });
    expect(logA.length).toBe(1);
    expect(logA[0]?.message).toBe("init a");
  });

  it("仓库外的孤立目录 isRepo=false，git 失败抛 AppError(CONFLICT)", async () => {
    const isolated = mkdtempSync(join(tmpdir(), "st-git-isolated-"));
    try {
      expect(await git.isRepo(isolated)).toBe(false);
      await expect(git.commitAll(isolated, "x")).rejects.toMatchObject({ code: "CONFLICT" });
    } finally {
      rmSync(isolated, { recursive: true, force: true });
    }
  });
});

describe("LocalGitProvider：嵌套仓库语义", () => {
  it("ensureRepo 在外层仓库的子目录内会初始化独立嵌套仓库", async () => {
    const outer = mkdtempSync(join(tmpdir(), "st-git-outer-"));
    const nested = join(outer, "knowledge");
    try {
      await git.ensureRepo(outer);
      await git.ensureRepo(nested); // 子目录：此前会被误判为已是仓库
      // 嵌套仓库成立：nested 自身有 .git、有 HEAD 提交
      expect(await git.revParse(nested, "HEAD")).toMatch(/^[0-9a-f]{40}$/);
      expect(await git.isRepo(nested)).toBe(true);
    } finally {
      rmSync(outer, { recursive: true, force: true });
    }
  });
});
