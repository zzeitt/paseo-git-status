import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Paseo records an agent's cwd when the agent is created and never follows the
 * provider's own directory changes. Claude Code keeps the live directory in its
 * session transcript, one JSON line per entry, so the transcript is the only
 * source for where the agent is actually working after EnterWorktree.
 */

export interface LiveCwdOptions {
  /** Defaults to `$PASEO_HOME` or `~/.paseo`. */
  paseoHome?: string;
  /** Defaults to `$CLAUDE_CONFIG_DIR` or `~/.claude`. */
  claudeHome?: string;
}

/** Enough for the last entries without reading a long session in full. */
const TAIL_BYTES = 256 * 1024;

/** Last `cwd` recorded in transcript text, scanning newest entries first. */
export function lastCwdFromTranscript(text: string): string | null {
  const lines = text.split("\n");
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim();
    if (!line) continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!entry || typeof entry !== "object") continue;
    const cwd = (entry as { cwd?: unknown }).cwd;
    if (typeof cwd === "string" && cwd.trim() !== "") return cwd;
  }
  return null;
}

interface AgentState {
  provider?: unknown;
  persistence?: { sessionId?: unknown } | null;
}

function readAgentState(
  agentId: string,
  paseoHome: string,
): AgentState | null {
  const agentsDir = path.join(paseoHome, "agents");
  let projects: string[];
  try {
    projects = fs.readdirSync(agentsDir);
  } catch {
    return null;
  }
  for (const project of projects) {
    const file = path.join(agentsDir, project, `${agentId}.json`);
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
      if (parsed && typeof parsed === "object") return parsed as AgentState;
    } catch {
      // Not this project's agent; keep looking.
    }
  }
  return null;
}

/** Newest transcript file for a session, if the session has one. */
function findTranscript(claudeHome: string, sessionId: string): string | null {
  const projectsDir = path.join(claudeHome, "projects");
  let projects: string[];
  try {
    projects = fs.readdirSync(projectsDir);
  } catch {
    return null;
  }
  let newest: { file: string; mtimeMs: number } | null = null;
  for (const project of projects) {
    const file = path.join(projectsDir, project, `${sessionId}.jsonl`);
    try {
      const stat = fs.statSync(file);
      if (!stat.isFile()) continue;
      if (!newest || stat.mtimeMs > newest.mtimeMs) {
        newest = { file, mtimeMs: stat.mtimeMs };
      }
    } catch {
      // The session does not live in this project directory.
    }
  }
  return newest?.file ?? null;
}

function readTail(file: string): string | null {
  let fd: number | null = null;
  try {
    fd = fs.openSync(file, "r");
    const size = fs.fstatSync(fd).size;
    const length = Math.min(size, TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, size - length);
    return buffer.toString("utf8");
  } catch {
    return null;
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

/**
 * The agent's live working directory from its Claude session transcript.
 * `null` when there is no Claude transcript, or when its last directory no
 * longer exists (a removed worktree).
 */
export function resolveLiveCwd(
  agentId: string,
  options: LiveCwdOptions = {},
): string | null {
  const paseoHome =
    options.paseoHome ??
    process.env.PASEO_HOME ??
    path.join(os.homedir(), ".paseo");
  const claudeHome =
    options.claudeHome ??
    process.env.CLAUDE_CONFIG_DIR ??
    path.join(os.homedir(), ".claude");

  const state = readAgentState(agentId, paseoHome);
  if (!state || state.provider !== "claude") return null;

  const sessionId = state.persistence?.sessionId;
  if (typeof sessionId !== "string" || sessionId === "") return null;

  const file = findTranscript(claudeHome, sessionId);
  if (!file) return null;

  const tail = readTail(file);
  if (!tail) return null;

  const cwd = lastCwdFromTranscript(tail);
  if (!cwd) return null;

  try {
    if (!fs.statSync(cwd).isDirectory()) return null;
  } catch {
    return null;
  }
  return cwd;
}
