import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { lastCwdFromTranscript, resolveLiveCwd } from "./live-cwd.ts";

function transcript(...entries: object[]): string {
  return entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n";
}

test("lastCwdFromTranscript keeps the latest cwd", () => {
  const text = transcript(
    { type: "user", cwd: "C:/repo" },
    { type: "assistant", cwd: "C:/repo/.claude/worktrees/wt" },
    { type: "cost-state" },
  );
  assert.equal(lastCwdFromTranscript(text), "C:/repo/.claude/worktrees/wt");
});

test("lastCwdFromTranscript skips malformed lines", () => {
  const text = [
    JSON.stringify({ cwd: "C:/a" }),
    "{not json",
    JSON.stringify({ cwd: "C:/b" }),
  ].join("\n");
  assert.equal(lastCwdFromTranscript(text), "C:/b");
});

test("lastCwdFromTranscript returns null without a cwd", () => {
  assert.equal(lastCwdFromTranscript(transcript({ type: "cost-state" })), null);
});

interface Fixture {
  paseoHome: string;
  claudeHome: string;
  repoDir: string;
  worktreeDir: string;
  root: string;
}

function fixture(): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gs-live-cwd-"));
  const paseoHome = path.join(root, "paseo");
  const claudeHome = path.join(root, "claude");
  const repoDir = path.join(root, "repo");
  const worktreeDir = path.join(root, "repo-wt");
  fs.mkdirSync(repoDir, { recursive: true });
  fs.mkdirSync(worktreeDir, { recursive: true });
  return { root, paseoHome, claudeHome, repoDir, worktreeDir };
}

function writeAgent(
  fx: Fixture,
  agentId: string,
  payload: object,
): void {
  const dir = path.join(fx.paseoHome, "agents", "C-demo-repo");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${agentId}.json`), JSON.stringify(payload));
}

function writeTranscript(
  fx: Fixture,
  project: string,
  sessionId: string,
  content: string,
  ageMs = 0,
): string {
  const dir = path.join(fx.claudeHome, "projects", project);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${sessionId}.jsonl`);
  fs.writeFileSync(file, content);
  const time = new Date(Date.now() - ageMs);
  fs.utimesSync(file, time, time);
  return file;
}

test("resolveLiveCwd reads the latest session transcript cwd", () => {
  const fx = fixture();
  writeAgent(fx, "agent-1", {
    provider: "claude",
    cwd: fx.repoDir,
    persistence: { sessionId: "session-1" },
  });
  writeTranscript(
    fx,
    "C-demo-repo--claude-worktrees-wt",
    "session-1",
    transcript(
      { type: "user", cwd: fx.repoDir },
      { type: "assistant", cwd: fx.worktreeDir },
    ),
  );

  assert.equal(
    resolveLiveCwd("agent-1", {
      paseoHome: fx.paseoHome,
      claudeHome: fx.claudeHome,
    }),
    fx.worktreeDir,
  );
});

test("resolveLiveCwd prefers the newest transcript copy", () => {
  const fx = fixture();
  writeAgent(fx, "agent-2", {
    provider: "claude",
    cwd: fx.repoDir,
    persistence: { sessionId: "session-2" },
  });
  writeTranscript(
    fx,
    "C-demo-repo",
    "session-2",
    transcript({ cwd: fx.repoDir }),
    60_000,
  );
  writeTranscript(
    fx,
    "C-demo-repo--claude-worktrees-wt",
    "session-2",
    transcript({ cwd: fx.worktreeDir }),
  );

  assert.equal(
    resolveLiveCwd("agent-2", {
      paseoHome: fx.paseoHome,
      claudeHome: fx.claudeHome,
    }),
    fx.worktreeDir,
  );
});

test("resolveLiveCwd ignores providers without a Claude transcript", () => {
  const fx = fixture();
  writeAgent(fx, "agent-3", {
    provider: "codex",
    cwd: fx.repoDir,
    persistence: { sessionId: "session-3" },
  });

  assert.equal(
    resolveLiveCwd("agent-3", {
      paseoHome: fx.paseoHome,
      claudeHome: fx.claudeHome,
    }),
    null,
  );
});

test("resolveLiveCwd ignores a cwd that no longer exists", () => {
  const fx = fixture();
  const missing = path.join(fx.root, "gone");
  writeAgent(fx, "agent-4", {
    provider: "claude",
    cwd: fx.repoDir,
    persistence: { sessionId: "session-4" },
  });
  writeTranscript(
    fx,
    "C-demo-repo",
    "session-4",
    transcript({ cwd: missing }),
  );

  assert.equal(
    resolveLiveCwd("agent-4", {
      paseoHome: fx.paseoHome,
      claudeHome: fx.claudeHome,
    }),
    null,
  );
});

test("resolveLiveCwd returns null for an unknown agent", () => {
  const fx = fixture();
  assert.equal(
    resolveLiveCwd("missing", {
      paseoHome: fx.paseoHome,
      claudeHome: fx.claudeHome,
    }),
    null,
  );
});
