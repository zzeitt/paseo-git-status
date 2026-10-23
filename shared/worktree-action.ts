/**
 * Decides what clicking a worktree row can do.
 *
 * The plugin cannot call a tool itself: switching worktrees means asking the
 * agent to call EnterWorktree or ExitWorktree, which costs a turn and only
 * works for Claude agents that are currently idle.
 */

export interface WorktreeActionInput {
  worktree: { path: string; isMain: boolean; isCurrent: boolean };
  agentStatus:
    | "initializing"
    | "idle"
    | "running"
    | "error"
    | "closed"
    | null;
  provider: string | null;
}

export type WorktreeAction =
  | { kind: "none" }
  | { kind: "enter"; path: string }
  | { kind: "exit"; path: string }
  | { kind: "blocked"; reason: "provider" | "busy" };

export function worktreeAction(input: WorktreeActionInput): WorktreeAction {
  if (input.worktree.isCurrent) return { kind: "none" };
  if (input.provider !== "claude") {
    return { kind: "blocked", reason: "provider" };
  }
  if (input.agentStatus !== "idle") {
    return { kind: "blocked", reason: "busy" };
  }
  return input.worktree.isMain
    ? { kind: "exit", path: input.worktree.path }
    : { kind: "enter", path: input.worktree.path };
}

/** The user message that makes the agent switch into an existing worktree. */
export function enterWorktreePrompt(path: string): string {
  return [
    `Enter the git worktree at "${path}" by calling the EnterWorktree tool with path set to that absolute path.`,
    "Do not use git commands to emulate the switch.",
    "After switching, run pwd and git rev-parse --abbrev-ref HEAD, then report the result.",
  ].join(" ");
}

/** The user message that makes the agent return to its original directory. */
export function exitWorktreePrompt(): string {
  return [
    'Leave the current worktree by calling the ExitWorktree tool with action "keep", returning this session to its original working directory.',
    "If this session did not enter its worktree through EnterWorktree, report that instead of emulating the switch.",
  ].join(" ");
}
