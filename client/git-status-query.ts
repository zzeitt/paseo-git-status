import { useRpc, useWorkspace } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { gitStatusRpc } from "../shared/git-status";

/** The pill is mounted only while its agent's composer is visible. */
export const PILL_POLL_MS = 5_000;
/** An open popover is being read, so it stays fresher. */
export const POPOVER_POLL_MS = 3_000;

export interface WorkspaceInfo {
  directory: string;
  name: string;
  title: string | null;
  projectKind: "git" | "non_git" | "directory";
  kind: "directory" | "local_checkout" | "checkout" | "worktree";
}

export function useWorkspaceInfo(workspaceId: string): WorkspaceInfo | null {
  return useWorkspace(workspaceId, (workspace) => ({
    directory: workspace.directory,
    name: workspace.name,
    title: workspace.title,
    projectKind: workspace.projectKind,
    kind: workspace.kind,
  }));
}

export function useGitStatus(
  directory: string | undefined,
  intervalMs: number,
  enabled = true,
) {
  const callGetGitStatus = useRpc(gitStatusRpc);
  return useQuery({
    queryKey: ["paseo-git-status", directory],
    queryFn: () => callGetGitStatus({ directory: directory as string }),
    enabled: enabled && Boolean(directory),
    refetchInterval: intervalMs,
    staleTime: Math.max(500, intervalMs - 1_000),
    // A workspace that is not a repository is a normal answer, not a transient
    // failure worth retrying.
    retry: false,
  });
}
