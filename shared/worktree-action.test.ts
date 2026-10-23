import assert from "node:assert/strict";
import { test } from "node:test";
import {
  enterWorktreePrompt,
  exitWorktreePrompt,
  worktreeAction,
  type WorktreeActionInput,
} from "./worktree-action.ts";

function input(overrides: Partial<WorktreeActionInput> = {}): WorktreeActionInput {
  return {
    worktree: { path: "C:/repo-wt", isMain: false, isCurrent: false },
    agentStatus: "idle",
    provider: "claude",
    ...overrides,
  };
}

test("the current worktree has no action", () => {
  assert.deepEqual(
    worktreeAction(
      input({ worktree: { path: "C:/repo", isMain: true, isCurrent: true } }),
    ),
    { kind: "none" },
  );
});

test("a linked worktree is entered", () => {
  assert.deepEqual(worktreeAction(input()), {
    kind: "enter",
    path: "C:/repo-wt",
  });
});

test("the main worktree is exited", () => {
  assert.deepEqual(
    worktreeAction(
      input({ worktree: { path: "C:/repo", isMain: true, isCurrent: false } }),
    ),
    { kind: "exit", path: "C:/repo" },
  );
});

test("only Claude agents can move between worktrees", () => {
  assert.deepEqual(worktreeAction(input({ provider: "codex" })), {
    kind: "blocked",
    reason: "provider",
  });
});

test("a busy agent cannot move between worktrees", () => {
  assert.deepEqual(worktreeAction(input({ agentStatus: "running" })), {
    kind: "blocked",
    reason: "busy",
  });
  assert.deepEqual(worktreeAction(input({ agentStatus: null })), {
    kind: "blocked",
    reason: "busy",
  });
});

test("the enter prompt names the tool and the absolute path", () => {
  const prompt = enterWorktreePrompt("C:/repo-wt");
  assert.match(prompt, /EnterWorktree/);
  assert.match(prompt, /C:\/repo-wt/);
});

test("the exit prompt names the tool and keeps the worktree", () => {
  const prompt = exitWorktreePrompt();
  assert.match(prompt, /ExitWorktree/);
  assert.match(prompt, /keep/);
});
