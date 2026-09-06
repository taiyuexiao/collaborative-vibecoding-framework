# SDD: S0.5 GitProvider 与本地实现（gitprov 包）

## 任务描述

定义仓库操作的抽象 `GitProvider`，并提供 `LocalGitProvider`（本地 git CLI 封装）：建库/提交/分支/worktree/改动清单/日志。daemon 的任务执行器（S3.3）与知识仓库的写入（S1.2）都经它落盘，后续 GiteeProvider 只需实现同一接口。

## 目标与验收

- [x] 接口方法：ensureRepo / isRepo / commitAll / commitFiles / currentBranch / ensureWorktree / removeWorktree / changedFiles / log / revParse
- [x] ensureRepo 幂等且自动配置仓库级 user.name/email（CI 与裸机可直接 commit）
- [x] changedFiles(base) 用 merge-base 计算与主分支的真实差异（不依赖 HEAD 位置）
- [x] 单元测试：临时目录跑真实 git 全链路

## 技术路线

用 `node:child_process.execFile` 逐条调 `git` CLI（非 libgit2/isomorphic-git）：CLI 语义稳定、与用户终端行为一致、零原生依赖。所有命令经 `run()` 统一包装：非零退出抛 `AppError("CONFLICT", stderr 摘要, {cmd, args})`。

## 原理

- **worktree**：`git worktree add <path> -b <branch>` 为任务创建隔离工作区；同一仓库多任务并行互不污染，分支共享同一对象库。
- **changedFiles**：`git diff --name-only $(git merge-base base HEAD)` —— 三点 diff 的显式版，避免误算已合入内容。

## 输入 / 输出

- 输入：core（AppError）、infra
- 输出：`GitProvider` 接口与 `LocalGitProvider`；被 S1.2（知识写入）、S3.3（任务执行）、S4.1（在途 diff）消费

## 上下游依赖

- 上游：S0.2/S0.4
- 下游：S1.2、S3.3、S4.1

## 接口签名

```ts
export interface CommitInfo { sha: string; message: string; date: string; author: string }
export interface GitProvider {
  isRepo(dir: string): Promise<boolean>
  ensureRepo(dir: string, opts?: { defaultBranch?: string }): Promise<void>
  commitAll(dir: string, message: string): Promise<string | null>   // 无改动返回 null
  commitFiles(dir: string, files: string[], message: string): Promise<string | null>
  currentBranch(dir: string): Promise<string>
  ensureWorktree(repoDir: string, worktreePath: string, branch: string): Promise<void>  // 已存在则跳过
  removeWorktree(repoDir: string, worktreePath: string): Promise<void>
  changedFiles(dir: string, baseBranch: string): Promise<string[]>
  log(dir: string, opts?: { n?: number; path?: string }): Promise<CommitInfo[]>
  revParse(dir: string, ref: string): Promise<string>
}
export class LocalGitProvider implements GitProvider
```

## 测试清单

- `local.test.ts`（临时目录真实 git）：ensureRepo 幂等 + 本地身份注入；commitAll 空改动返回 null；commitFiles 只提交指定文件；ensureWorktree 幂等、worktree 内提交对主仓库可见；changedFiles 正确列出与 main 的差异；log/revParse。

## 报错与解决

1. **报错**：commit 报 `Author identity unknown`（容器/新环境无全局 git 身份）。
   **解决**：ensureRepo 时检测并写入仓库级 `user.name=superteam` / `user.email=superteam@local`（仅在未配置时），不污染全局配置。

2. **报错**：ensureWorktree 幂等判断失效，第二次调用报 `fatal: '.../wt-task' already exists`。根因：macOS `/var/folders` 是 `/private/var/folders` 的符号链接，git porcelain 返回 realpath，与传入路径字符串不相等。
   **解决**：porcelain 路径与请求路径均按 realpath 归一后比对。注意 `fs.realpathSync(p,{throwIfNoEntry:false})` 在 Node 26 上对不存在路径仍抛 ENOENT（未生效），改用自行实现的 `bestEffortRealpath`：存在取 realpath，不存在取父目录 realpath + basename 拼接。

3. **报错（测试期望错误，非实现缺陷）**：期望 worktree 上的提交出现在主仓库 `git log` 中。git 正确行为是任务分支提交不在 main 历史里。
   **解决**：断言改为共享对象库语义——`revParse(dir, refs/heads/task/demo)` 等于 worktree HEAD，且 main log 不含该提交。changedFiles 同理：该 API 只对任务分支/worktree 有意义（base=main），主分支自身调用恒为空集。

## 实际偏差

无。
