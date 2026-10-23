import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { RpcInput } from "@getpaseo/plugin";
import {
  type GitStatus,
  type GitWorktree,
  gitStatusRpc,
} from "../shared/git-status";
import {
  baseName,
  parsePorcelainV2,
  parseWorktreeList,
  summarize,
  type PorcelainStatus,
} from "../shared/parse";
import { resolveLiveCwd } from "./live-cwd";

interface GitResult {
  stdout: string;
  code: number;
}

/**
 * Runs git without a shell. A non-zero exit is a normal answer here (no repo,
 * no commits), so it resolves with the code instead of rejecting; only a
 * spawn failure such as git not being installed rejects.
 */
function runGit(
  directory: string,
  args: string[],
  timeoutMs = 10_000,
): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      {
        cwd: directory,
        timeout: timeoutMs,
        maxBuffer: 32 * 1024 * 1024,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ stdout, code: 0 });
          return;
        }
        const code = (error as { code?: unknown }).code;
        if (typeof code === "number") {
          resolve({ stdout, code });
          return;
        }
        reject(new Error(stderr.trim() || error.message));
      },
    );
  });
}

let spawnError: string | null = null;

async function tryGit(
  directory: string,
  args: string[],
): Promise<string | null> {
  try {
    const result = await runGit(directory, args);
    return result.code === 0 ? result.stdout : null;
  } catch (error) {
    spawnError ??= error instanceof Error ? error.message : String(error);
    return null;
  }
}

interface StatusDirectories {
  directory: string;
  paseoDirectory: string;
  liveCwd: string | null;
}

function emptyStatus(
  error: string | null,
  directories: StatusDirectories,
): GitStatus {
  const status: PorcelainStatus = {
    head: null,
    branch: null,
    detached: false,
    upstream: null,
    ahead: null,
    behind: null,
    files: [],
    untracked: [],
    ignored: [],
  };
  return {
    ...directories,
    isGit: false,
    current: null,
    worktrees: [],
    head: null,
    upstream: null,
    ahead: null,
    behind: null,
    changes: [],
    untracked: [],
    counts: summarize(status),
    lastCommit: null,
    stashCount: 0,
    operation: null,
    error,
  };
}

function detectOperation(gitDir: string | null): GitStatus["operation"] {
  if (!gitDir) return null;
  const has = (name: string) => {
    try {
      return fs.existsSync(path.join(gitDir, name));
    } catch {
      return false;
    }
  };
  if (has("rebase-merge") || has("rebase-apply")) return "rebase";
  if (has("MERGE_HEAD")) return "merge";
  if (has("CHERRY_PICK_HEAD")) return "cherry-pick";
  if (has("REVERT_HEAD")) return "revert";
  if (has("BISECT_LOG")) return "bisect";
  return null;
}

export async function getGitStatus({
  directory,
  agentId,
}: RpcInput<typeof gitStatusRpc>): Promise<GitStatus> {
  const paseoDirectory = path.resolve(directory);
  const liveCwd = agentId ? resolveLiveCwd(agentId) : null;
  const resolved = liveCwd ?? paseoDirectory;
  const directories: StatusDirectories = {
    directory: resolved,
    paseoDirectory,
    liveCwd,
  };
  if (!fs.existsSync(resolved)) {
    return emptyStatus("Directory does not exist.", directories);
  }

  spawnError = null;
  const [inside, bareRepository] = await Promise.all([
    tryGit(resolved, ["rev-parse", "--is-inside-work-tree"]),
    tryGit(resolved, ["rev-parse", "--is-bare-repository"]),
  ]);

  const isBare = bareRepository?.trim() === "true";
  const isGit = inside?.trim() === "true" || isBare;
  if (!isGit) {
    return emptyStatus(spawnError, directories);
  }

  const [toplevelOut, gitDirOut, statusOut, worktreeOut, logOut, stashOut] =
    await Promise.all([
      tryGit(resolved, ["rev-parse", "--show-toplevel"]),
      tryGit(resolved, ["rev-parse", "--absolute-git-dir"]),
      isBare
        ? Promise.resolve(null)
        : tryGit(resolved, ["status", "--porcelain=v2", "--branch", "-z"]),
      tryGit(resolved, ["worktree", "list", "--porcelain"]),
      tryGit(resolved, ["log", "-1", "--format=%H%x1f%h%x1f%s%x1f%an%x1f%aI"]),
      tryGit(resolved, ["stash", "list", "--format=%gd"]),
    ]);

  const status = parsePorcelainV2(statusOut ?? "");
  const toplevel = toplevelOut?.trim() || null;
  const gitDir = gitDirOut?.trim() || null;
  const worktrees = parseWorktreeList(
    worktreeOut ?? "",
    toplevel ?? resolved,
  );

  let current: GitWorktree | null =
    worktrees.find((worktree) => worktree.isCurrent) ?? null;

  if (!current) {
    const currentPath = toplevel ?? resolved;
    current = {
      path: currentPath,
      name: baseName(currentPath),
      head: status.head,
      branch: status.branch,
      detached: status.detached,
      bare: isBare,
      locked: false,
      prunable: false,
      isMain: worktrees.length === 0,
      isCurrent: true,
    };
    worktrees.unshift(current);
  } else {
    // The status headers know the checked-out branch and commit even when the
    // worktree list is unavailable or stale.
    current = {
      ...current,
      head: status.head ?? current.head,
      branch: status.branch ?? current.branch,
      detached: status.detached || current.detached,
    };
    const index = worktrees.findIndex((worktree) => worktree.isCurrent);
    if (index >= 0) worktrees[index] = current;
  }

  let lastCommit: GitStatus["lastCommit"] = null;
  const log = logOut?.trim();
  if (log) {
    const [hash, shortHash, subject, author, date] = log.split("\x1f");
    if (hash && shortHash) {
      lastCommit = {
        hash,
        shortHash,
        subject: subject ?? "",
        author: author ?? "",
        date: date ?? "",
      };
    }
  }

  const stashCount = stashOut
    ? stashOut.split("\n").filter((line) => line.trim() !== "").length
    : 0;

  return {
    ...directories,
    isGit: true,
    current,
    worktrees,
    head: status.head,
    upstream: status.upstream,
    ahead: status.ahead,
    behind: status.behind,
    changes: status.files,
    untracked: status.untracked,
    counts: summarize(status),
    lastCommit,
    stashCount,
    operation: detectOperation(gitDir),
    error: statusOut === null && !isBare ? "git status failed." : null,
  };
}
