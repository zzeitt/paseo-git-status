import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatPillLabel,
  formatPillTitle,
  parsePorcelainV2,
  parseWorktreeList,
  resolveGitDirectory,
  summarize,
} from "./parse.ts";

/** Records are NUL-terminated, exactly like `git status --porcelain=v2 --branch -z`. */
function z(...records: string[]): string {
  return records.join("\0") + "\0";
}

const OID = "1111111111111111111111111111111111111111";

test("parses a clean branch with upstream and divergence", () => {
  const status = parsePorcelainV2(
    z(
      `# branch.oid ${OID}`,
      "# branch.head main",
      "# branch.upstream origin/main",
      "# branch.ab +2 -1",
    ),
  );
  assert.deepEqual(status, {
    head: OID,
    branch: "main",
    detached: false,
    upstream: "origin/main",
    ahead: 2,
    behind: 1,
    files: [],
    untracked: [],
    ignored: [],
  });
});

test("parses a detached HEAD", () => {
  const status = parsePorcelainV2(
    z(`# branch.oid ${OID}`, "# branch.head (detached)"),
  );
  assert.equal(status.branch, null);
  assert.equal(status.detached, true);
  assert.equal(status.head, OID);
});

test("parses an empty repository", () => {
  const status = parsePorcelainV2(
    z("# branch.oid (initial)", "# branch.head main"),
  );
  assert.equal(status.head, null);
  assert.equal(status.branch, "main");
  assert.equal(status.detached, false);
});

test("parses entries, renames, untracked files and conflicts", () => {
  const status = parsePorcelainV2(
    z(
      `# branch.oid ${OID}`,
      "# branch.head main",
      "1 .M N... 100644 100644 100644 aaa bbb src/modified file.ts",
      "1 MM N... 100644 100644 100644 aaa bbb both.txt",
      "2 R. N... 100644 100644 100644 aaa bbb R100 new name.txt",
      "old name.txt",
      "? untracked.txt",
      "u UU N... 100644 100644 100644 100644 aaa bbb ccc conflict.txt",
    ),
  );

  assert.deepEqual(status.files, [
    { path: "src/modified file.ts", index: ".", worktree: "M" },
    { path: "both.txt", index: "M", worktree: "M" },
    {
      path: "new name.txt",
      origPath: "old name.txt",
      index: "R",
      worktree: ".",
    },
    { path: "conflict.txt", index: "U", worktree: "U" },
  ]);
  assert.deepEqual(status.untracked, ["untracked.txt"]);
});

test("counts staged, unstaged, untracked and conflicted entries", () => {
  const status = parsePorcelainV2(
    z(
      `# branch.oid ${OID}`,
      "# branch.head main",
      "1 .M N... 100644 100644 100644 aaa bbb modified.txt",
      "1 MM N... 100644 100644 100644 aaa bbb both.txt",
      "2 R. N... 100644 100644 100644 aaa bbb R100 new.txt",
      "old.txt",
      "? untracked.txt",
      "u UU N... 100644 100644 100644 100644 aaa bbb ccc conflict.txt",
    ),
  );

  assert.deepEqual(summarize(status), {
    staged: 2,
    unstaged: 2,
    untracked: 1,
    conflicted: 1,
    dirty: true,
  });
});

test("a clean status is not dirty", () => {
  const status = parsePorcelainV2(
    z(`# branch.oid ${OID}`, "# branch.head main", "# branch.ab +0 -0"),
  );
  assert.equal(summarize(status).dirty, false);
  assert.equal(status.ahead, 0);
  assert.equal(status.behind, 0);
});

test("parses worktrees and marks the current one across path separators", () => {
  const worktrees = parseWorktreeList(
    [
      "worktree C:/repo",
      "HEAD aaa",
      "branch refs/heads/main",
      "",
      "worktree C:/repo-wt",
      "HEAD bbb",
      "branch refs/heads/feature/x",
      "",
      "worktree C:/detached",
      "HEAD ccc",
      "detached",
      "",
      "worktree C:/bare.git",
      "HEAD ddd",
      "bare",
      "",
    ].join("\n"),
    "C:\\repo-wt",
  );

  assert.equal(worktrees.length, 4);
  assert.deepEqual(
    worktrees.map((worktree) => ({
      name: worktree.name,
      path: worktree.path,
      branch: worktree.branch,
      head: worktree.head,
      detached: worktree.detached,
      bare: worktree.bare,
      isMain: worktree.isMain,
      isCurrent: worktree.isCurrent,
    })),
    [
      {
        name: "repo",
        path: "C:/repo",
        branch: "main",
        head: "aaa",
        detached: false,
        bare: false,
        isMain: true,
        isCurrent: false,
      },
      {
        name: "repo-wt",
        path: "C:/repo-wt",
        branch: "feature/x",
        head: "bbb",
        detached: false,
        bare: false,
        isMain: false,
        isCurrent: true,
      },
      {
        name: "detached",
        path: "C:/detached",
        branch: null,
        head: "ccc",
        detached: true,
        bare: false,
        isMain: false,
        isCurrent: false,
      },
      {
        name: "bare.git",
        path: "C:/bare.git",
        branch: null,
        head: "ddd",
        detached: false,
        bare: true,
        isMain: false,
        isCurrent: false,
      },
    ],
  );
});

test("marks no worktree current when the path is unknown", () => {
  const worktrees = parseWorktreeList(
    "worktree /repo\nHEAD aaa\nbranch refs/heads/main\n",
  );
  assert.equal(worktrees[0].isCurrent, false);
  assert.equal(worktrees[0].isMain, true);
});

test("prefers the agent cwd over the workspace directory", () => {
  assert.equal(
    resolveGitDirectory("C:/repo-wt", "C:/repo"),
    "C:/repo-wt",
  );
  assert.equal(
    resolveGitDirectory("  C:/repo-wt  ", "C:/repo"),
    "C:/repo-wt",
  );
  assert.equal(resolveGitDirectory(null, "C:/repo"), "C:/repo");
  assert.equal(resolveGitDirectory("", "C:/repo"), "C:/repo");
  assert.equal(resolveGitDirectory(null, null), null);
});

test("formats a plain pill label", () => {
  assert.equal(
    formatPillLabel({
      worktreeName: "paseo-git-status",
      branch: "main",
      head: OID,
      detached: false,
      ahead: null,
      behind: null,
      dirty: false,
      conflicted: 0,
    }),
    "paseo-git-status",
  );
});

test("keeps the branch when the worktree leaves room for it", () => {
  assert.equal(
    formatPillLabel({
      worktreeName: "rainmeter-sp",
      branch: "main",
      head: OID,
      detached: false,
      ahead: 0,
      behind: 0,
      dirty: true,
      conflicted: 0,
    }),
    "rainmeter-sp* · main",
  );
});

test("formats ahead, behind, dirty and conflict markers", () => {
  assert.equal(
    formatPillLabel({
      worktreeName: "paseo-git-status",
      branch: "main",
      head: OID,
      detached: false,
      ahead: 2,
      behind: 1,
      dirty: true,
      conflicted: 0,
    }),
    "paseo-git-status* ↑2↓1",
  );
  assert.equal(
    formatPillLabel({
      worktreeName: "paseo-git-status",
      branch: "main",
      head: OID,
      detached: false,
      ahead: 0,
      behind: 0,
      dirty: true,
      conflicted: 1,
    }),
    "paseo-git-status*!",
  );
});

test("formats a detached HEAD and an empty repository", () => {
  assert.equal(
    formatPillLabel({
      worktreeName: "repo",
      branch: null,
      head: OID,
      detached: true,
      ahead: null,
      behind: null,
      dirty: false,
      conflicted: 0,
    }),
    "repo · @1111111",
  );
  assert.equal(
    formatPillLabel({
      worktreeName: "repo",
      branch: "main",
      head: null,
      detached: false,
      ahead: null,
      behind: null,
      dirty: false,
      conflicted: 0,
    }),
    "repo · main",
  );
});

test("the pill title keeps the full worktree, branch, and path", () => {
  assert.equal(
    formatPillTitle({
      worktreeName: "a-very-long-worktree-name",
      branch: "feature/a-very-long-branch-name",
      head: OID,
      detached: false,
      path: "C:/repo/worktrees/a-very-long-worktree-name",
    }),
    "a-very-long-worktree-name · feature/a-very-long-branch-name — C:/repo/worktrees/a-very-long-worktree-name",
  );
});

test("the pill title shows the short commit for a detached head", () => {
  assert.equal(
    formatPillTitle({
      worktreeName: "wt",
      branch: null,
      head: OID,
      detached: true,
      path: "C:/repo/wt",
    }),
    "wt · @1111111 — C:/repo/wt",
  );
});

test("truncates long worktree and branch names", () => {
  assert.equal(
    formatPillLabel({
      worktreeName: "a-very-long-worktree-name",
      branch: "feature/a-very-long-branch-name",
      head: OID,
      detached: false,
      ahead: null,
      behind: null,
      dirty: false,
      conflicted: 0,
    }),
    "a-very-long-worktre…",
  );
});
