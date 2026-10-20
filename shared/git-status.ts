import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const changeSchema = z.object({
  path: z.string(),
  origPath: z.string().optional(),
  /** Index (staged) status character, e.g. `M` or `.`. */
  index: z.string(),
  /** Worktree (unstaged) status character, e.g. `M` or `.`. */
  worktree: z.string(),
});

export const worktreeSchema = z.object({
  path: z.string(),
  name: z.string(),
  head: z.string().nullable(),
  branch: z.string().nullable(),
  detached: z.boolean(),
  bare: z.boolean(),
  locked: z.boolean(),
  prunable: z.boolean(),
  isMain: z.boolean(),
  isCurrent: z.boolean(),
});

export const operationSchema = z.enum([
  "merge",
  "rebase",
  "cherry-pick",
  "revert",
  "bisect",
]);

/**
 * Reads one directory's git state. The directory is the Paseo workspace
 * directory, which is the worktree the agent's conversation belongs to.
 */
export const gitStatusRpc = defineRpc({
  name: "gitstatus.get",
  input: z.object({
    directory: z.string().min(1),
  }),
  output: z.object({
    isGit: z.boolean(),
    current: worktreeSchema.nullable(),
    worktrees: z.array(worktreeSchema),
    head: z.string().nullable(),
    upstream: z.string().nullable(),
    ahead: z.number().int().nullable(),
    behind: z.number().int().nullable(),
    changes: z.array(changeSchema),
    untracked: z.array(z.string()),
    counts: z.object({
      staged: z.number().int(),
      unstaged: z.number().int(),
      untracked: z.number().int(),
      conflicted: z.number().int(),
      dirty: z.boolean(),
    }),
    lastCommit: z
      .object({
        hash: z.string(),
        shortHash: z.string(),
        subject: z.string(),
        author: z.string(),
        date: z.string(),
      })
      .nullable(),
    stashCount: z.number().int(),
    operation: operationSchema.nullable(),
    error: z.string().nullable(),
  }),
});

export type GitStatus = z.output<typeof gitStatusRpc.output>;
export type GitWorktree = z.output<typeof worktreeSchema>;
export type GitChange = z.output<typeof changeSchema>;
