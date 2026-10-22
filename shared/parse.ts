/**
 * Pure parsers for the git output this plugin reads.
 *
 * Everything here is deliberately free of Node and React Native globals so the
 * same module can run in the daemon and in the app: the daemon parses git
 * output, the app formats the composer pill from the result.
 */

export interface PorcelainFile {
  path: string;
  /** Present for renames and copies. */
  origPath?: string;
  /** Index (staged) status character, e.g. `M` or `.`. */
  index: string;
  /** Worktree (unstaged) status character, e.g. `M` or `.`. */
  worktree: string;
}

export interface PorcelainStatus {
  head: string | null;
  branch: string | null;
  detached: boolean;
  upstream: string | null;
  ahead: number | null;
  behind: number | null;
  files: PorcelainFile[];
  untracked: string[];
  ignored: string[];
}

export interface WorktreeEntry {
  path: string;
  /** Last path segment: the name people use for a worktree. */
  name: string;
  head: string | null;
  branch: string | null;
  detached: boolean;
  bare: boolean;
  locked: boolean;
  prunable: boolean;
  /** The first entry in `git worktree list` is the main worktree. */
  isMain: boolean;
  isCurrent: boolean;
}

export interface StatusCounts {
  staged: number;
  unstaged: number;
  untracked: number;
  conflicted: number;
  dirty: boolean;
}

const UNMERGED = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);

/** `git status --porcelain=v2 --branch -z` into its branch header and changes. */
export function parsePorcelainV2(raw: string): PorcelainStatus {
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

  const fields = raw.split("\0");
  for (let i = 0; i < fields.length; i += 1) {
    const line = fields[i];
    if (line === "") continue;

    if (line.startsWith("# ")) {
      const [kind, value] = line.slice(2).split(" ");
      if (kind === "branch.oid") {
        status.head = value && value !== "(initial)" ? value : null;
      } else if (kind === "branch.head") {
        if (value === "(detached)") {
          status.detached = true;
          status.branch = null;
        } else if (value) {
          status.branch = value;
        }
      } else if (kind === "branch.upstream") {
        status.upstream = value || null;
      } else if (kind === "branch.ab") {
        const ahead = /^\+(\d+)$/.exec(value ?? "");
        const behind = /^-(\d+)$/.exec(line.slice(2).split(" ")[2] ?? "");
        status.ahead = ahead ? Number(ahead[1]) : null;
        status.behind = behind ? Number(behind[1]) : null;
      }
      continue;
    }

    if (line.startsWith("1 ")) {
      // 1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
      const parts = line.split(" ");
      const [index, worktree] = splitXY(parts[1]);
      status.files.push({ index, worktree, path: parts.slice(8).join(" ") });
      continue;
    }

    if (line.startsWith("2 ")) {
      // 2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path>\0<origPath>
      const parts = line.split(" ");
      const [index, worktree] = splitXY(parts[1]);
      const origPath = fields[i + 1];
      if (origPath !== undefined && origPath !== "") i += 1;
      status.files.push({
        index,
        worktree,
        path: parts.slice(9).join(" "),
        ...(origPath ? { origPath } : {}),
      });
      continue;
    }

    if (line.startsWith("u ")) {
      // u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>
      const parts = line.split(" ");
      const [index, worktree] = splitXY(parts[1]);
      status.files.push({ index, worktree, path: parts.slice(10).join(" ") });
      continue;
    }

    if (line.startsWith("? ")) {
      status.untracked.push(line.slice(2));
      continue;
    }

    if (line.startsWith("! ")) {
      status.ignored.push(line.slice(2));
    }
  }

  return status;
}

function splitXY(value: string | undefined): [string, string] {
  if (!value) return [".", "."];
  return [value[0] ?? ".", value[1] ?? "."];
}

/** `git worktree list --porcelain` into entries, marking the current worktree. */
export function parseWorktreeList(
  raw: string,
  currentPath?: string | null,
): WorktreeEntry[] {
  const entries: WorktreeEntry[] = [];
  let current: {
    path: string;
    head: string | null;
    branch: string | null;
    detached: boolean;
    bare: boolean;
    locked: boolean;
    prunable: boolean;
  } | null = null;

  const push = () => {
    if (!current) return;
    entries.push({
      ...current,
      name: baseName(current.path),
      isMain: entries.length === 0,
      isCurrent: false,
    });
    current = null;
  };

  for (const rawLine of raw.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (line.startsWith("worktree ")) {
      push();
      current = {
        path: line.slice("worktree ".length).trim(),
        head: null,
        branch: null,
        detached: false,
        bare: false,
        locked: false,
        prunable: false,
      };
    } else if (current) {
      if (line.startsWith("HEAD ")) {
        current.head = line.slice("HEAD ".length).trim() || null;
      } else if (line.startsWith("branch ")) {
        const ref = line.slice("branch ".length).trim();
        current.branch = ref.startsWith("refs/heads/")
          ? ref.slice("refs/heads/".length)
          : ref || null;
      } else if (line === "detached") {
        current.detached = true;
      } else if (line === "bare") {
        current.bare = true;
      } else if (line === "locked" || line.startsWith("locked ")) {
        current.locked = true;
      } else if (line === "prunable" || line.startsWith("prunable ")) {
        current.prunable = true;
      }
    }
  }
  push();

  const wanted = currentPath ? normalizePath(currentPath) : null;
  if (wanted) {
    for (const entry of entries) {
      if (normalizePath(entry.path) === wanted) entry.isCurrent = true;
    }
  }
  return entries;
}

/** Lower-cased forward-slash form, so Windows git paths compare reliably. */
function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

/** Last segment of a path, accepting either separator. */
export function baseName(value: string): string {
  const parts = value.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? value;
}

export function isConflicted(file: PorcelainFile): boolean {
  return UNMERGED.has(`${file.index}${file.worktree}`);
}

export function summarize(status: PorcelainStatus): StatusCounts {
  let staged = 0;
  let unstaged = 0;
  let conflicted = 0;
  for (const file of status.files) {
    if (isConflicted(file)) {
      conflicted += 1;
      continue;
    }
    if (file.index !== "." && file.index !== " ") staged += 1;
    if (file.worktree !== "." && file.worktree !== " ") unstaged += 1;
  }
  return {
    staged,
    unstaged,
    untracked: status.untracked.length,
    conflicted,
    dirty: status.files.length > 0 || status.untracked.length > 0,
  };
}

/**
 * The directory whose git state a session should show.
 *
 * An agent can have its own cwd that differs from its workspace directory, for
 * example after a fork or a move into a linked worktree. The agent cwd is the
 * session's real location, so it wins; the workspace directory is the fallback
 * for clients that do not expose an agent cwd.
 */
export function resolveGitDirectory(
  agentCwd: string | null | undefined,
  workspaceDirectory: string | null | undefined,
): string | null {
  const agent = agentCwd?.trim();
  if (agent) return agent;
  const workspace = workspaceDirectory?.trim();
  return workspace || null;
}

export interface PillLabelInput {
  worktreeName: string;
  branch: string | null;
  head: string | null;
  detached: boolean;
  ahead: number | null;
  behind: number | null;
  dirty: boolean;
  conflicted: number;
}

/**
 * The one-line composer label. Worktree first, because the whole point is
 * knowing which checkout this conversation belongs to.
 */
export function formatPillLabel(input: PillLabelInput): string {
  const name = truncate(input.worktreeName, 20);
  const branch =
    input.branch ?? (input.head ? `@${input.head.slice(0, 7)}` : "(no commits)");
  const divergence = [
    input.ahead ? `↑${input.ahead}` : "",
    input.behind ? `↓${input.behind}` : "",
  ].join("");
  const divergenceText = divergence ? ` ${divergence}` : "";
  // Markers sit directly after the worktree so the narrow composer track does
  // not hide them behind the branch.
  const base = `${name}${input.dirty ? "*" : ""}${
    input.conflicted > 0 ? "!" : ""
  }${divergenceText}`;
  // The Git pill is usually the last item in a narrow track. Keep the branch
  // only when the worktree and its markers leave room for it; the popover
  // always has the full branch.
  return base.length + 3 + branch.length <= 22
    ? `${base} · ${branch}`
    : base;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
