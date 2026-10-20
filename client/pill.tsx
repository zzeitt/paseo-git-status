import type {
  PluginButtonIconProps,
  PluginButtonRegistration,
  PluginClientContext,
} from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useEffect } from "react";
import { formatPillLabel } from "../shared/parse";
import { PILL_POLL_MS, useGitStatus, useWorkspaceInfo } from "./git-status-query";
import { GitStatusPopover } from "./popover";

type Paseo = PluginClientContext["paseo"];
type AgentList = Awaited<ReturnType<Paseo["agents"]["list"]>>;
type AgentUpdate = Parameters<Parameters<Paseo["agents"]["subscribe"]>[0]>[0];
type AgentObservation = NonNullable<AgentList["subscription"]>;
type WorkspaceList = Awaited<ReturnType<Paseo["workspaces"]["list"]>>;
type WorkspaceUpdate = Parameters<
  Parameters<Paseo["workspaces"]["subscribe"]>[0]
>[0];
type WorkspaceObservation = NonNullable<WorkspaceList["subscription"]>;

const RETRY_MIN_MS = 2_000;
const RETRY_MAX_MS = 60_000;

/** The registration is created from the icon, so the icon reaches it here. */
interface RegistrationBox {
  current?: PluginButtonRegistration;
}

interface PillState {
  workspaceId: string;
  registration: PluginButtonRegistration;
  /** True when a workspace-kind check hid the pill, not the git read. */
  hiddenByWorkspace: boolean;
}

function createPillIcon(registration: RegistrationBox) {
  return function GitStatusPillIcon({
    size,
    color,
    workspaceId,
  }: PluginButtonIconProps) {
    const workspace = useWorkspaceInfo(workspaceId);
    const definitelyNotGit = workspace?.projectKind === "non_git";
    const query = useGitStatus(
      workspace?.directory,
      PILL_POLL_MS,
      Boolean(workspace) && !definitelyNotGit,
    );
    const status = query.data;
    const current = status?.current ?? null;

    const label =
      status?.isGit && current
        ? formatPillLabel({
            worktreeName: current.name,
            branch: current.branch,
            head: current.head,
            detached: current.detached,
            ahead: status.ahead,
            behind: status.behind,
            dirty: status.counts.dirty,
            conflicted: status.counts.conflicted,
          })
        : "Git";

    useEffect(() => {
      if (definitelyNotGit) {
        registration.current?.update({ visible: false });
        return;
      }
      // Before the first answer the pill stays icon-led rather than claiming
      // a branch it has not read yet.
      if (!status) return;
      if (!status.isGit) {
        registration.current?.update({ visible: false });
        return;
      }
      // Label-only, mirroring paseo-skills: a broader patch rebuilds the
      // button instead of updating it in place.
      registration.current?.update({ label });
    }, [definitelyNotGit, status, label]);

    return <Icon name="GitBranch" size={size} color={color} />;
  };
}

/**
 * One pill per agent, mirroring how paseo-skills follows agents. The pill is
 * hidden for workspaces Paseo already knows are not git repositories; a
 * directory that turns out not to be a repository hides itself after the first
 * read.
 */
export function contributePills(client: PluginClientContext) {
  const pills = new Map<string, PillState>();
  const workspaceKinds = new Map<
    string,
    "git" | "non_git" | "directory"
  >();
  const lifetime = new AbortController();
  let stopped = false;
  let observation: AgentObservation | null = null;
  let workspaceObservation: WorkspaceObservation | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let retryDelay = RETRY_MIN_MS;

  /**
   * A pill can be hidden because Paseo says the workspace is not a repository,
   * or because the git read said the directory is not one. Only the first case
   * is undone when the workspace becomes a repository, so the two are tracked
   * separately and a workspace update re-arms the read.
   */
  function syncWorkspacePills(workspaceId: string) {
    const kind = workspaceKinds.get(workspaceId);
    if (!kind) return;
    for (const pill of pills.values()) {
      if (pill.workspaceId !== workspaceId) continue;
      if (kind === "non_git") {
        pill.registration.update({ visible: false });
        pill.hiddenByWorkspace = true;
      } else if (kind === "git") {
        pill.registration.update({ visible: true });
        pill.hiddenByWorkspace = false;
      } else if (pill.hiddenByWorkspace) {
        // A plain directory can become a repository later. Let the icon mount
        // and read it again; it hides itself if the read still says no.
        pill.registration.update({ visible: true });
        pill.hiddenByWorkspace = false;
      }
    }
  }

  function removePill(agentId: string) {
    pills.get(agentId)?.registration.remove();
    pills.delete(agentId);
  }

  function addPill(agentId: string, workspaceId: string) {
    if (stopped) return;
    const existing = pills.get(agentId);
    if (existing?.workspaceId === workspaceId) return;
    if (existing) removePill(agentId);

    const box: RegistrationBox = {};
    box.current = client.addComposerPill({
      id: "git-status",
      workspaceId,
      agentId,
      button: {
        title: "Git status",
        label: "Git",
        icon: createPillIcon(box),
        behavior: { kind: "popover", Content: GitStatusPopover },
      },
    });
    const hiddenByWorkspace =
      workspaceKinds.get(workspaceId) === "non_git";
    pills.set(agentId, {
      workspaceId,
      registration: box.current,
      hiddenByWorkspace,
    });
    if (hiddenByWorkspace) box.current.update({ visible: false });
  }

  function applySnapshot(list: AgentList) {
    if (stopped) return;
    const listed = new Map<string, string>();
    for (const { agent } of list.entries) {
      if (agent.workspaceId) listed.set(agent.id, agent.workspaceId);
    }
    for (const agentId of [...pills.keys()]) {
      if (!listed.has(agentId)) removePill(agentId);
    }
    listed.forEach((workspaceId, agentId) => addPill(agentId, workspaceId));
  }

  function applyUpdate(update: AgentUpdate) {
    if (update.kind === "remove") {
      removePill(update.agentId);
      return;
    }
    if (update.agent.workspaceId) {
      addPill(update.agent.id, update.agent.workspaceId);
    }
  }

  function applyWorkspaceSnapshot(list: WorkspaceList) {
    if (stopped) return;
    for (const workspace of list.entries) {
      workspaceKinds.set(workspace.id, workspace.projectKind);
    }
    for (const pill of pills.values()) {
      syncWorkspacePills(pill.workspaceId);
    }
  }

  function applyWorkspaceUpdate(update: WorkspaceUpdate) {
    if (update.kind === "remove") {
      // 0.11 and 0.12 name the removed workspace differently.
      const removed = update as unknown as { id?: string; workspaceId?: string };
      const removedId = removed.id ?? removed.workspaceId;
      if (removedId) workspaceKinds.delete(removedId);
      return;
    }
    workspaceKinds.set(update.workspace.id, update.workspace.projectKind);
    syncWorkspacePills(update.workspace.id);
  }

  function reopen(error: unknown) {
    void observation?.release().catch(() => undefined);
    void workspaceObservation?.release().catch(() => undefined);
    observation = null;
    workspaceObservation = null;
    if (stopped || retry !== null) return;
    console.warn("paseo-git-status: agent observation failed; reopening", error);
    retry = setTimeout(() => {
      retry = null;
      void open();
    }, retryDelay);
    retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS);
  }

  async function open() {
    try {
      const agents = await client.paseo.agents.list({
        subscribe: {},
        signal: lifetime.signal,
      });
      if (lifetime.signal.aborted) return;
      const agentSubscription = agents.subscription;
      if (!agentSubscription) {
        throw new Error("The host returned no agent observation.");
      }
      observation = agentSubscription;
      agentSubscription.subscribe({
        snapshot(list) {
          retryDelay = RETRY_MIN_MS;
          applySnapshot(list);
        },
        update(message) {
          if (message.type === "agent_update") {
            applyUpdate(message.payload as AgentUpdate);
          }
        },
        error: reopen,
      });

      const workspaces = await client.paseo.workspaces.list({ subscribe: {} });
      if (lifetime.signal.aborted) return;
      const workspaceSubscription = workspaces.subscription;
      if (!workspaceSubscription) {
        throw new Error("The host returned no workspace observation.");
      }
      workspaceObservation = workspaceSubscription;
      workspaceSubscription.subscribe({
        snapshot(list) {
          applyWorkspaceSnapshot(list);
        },
        update(message) {
          if (message.type === "workspace_update") {
            applyWorkspaceUpdate(message.payload as WorkspaceUpdate);
          }
        },
        error: reopen,
      });
    } catch (error) {
      reopen(error);
    }
  }

  void open();

  return () => {
    stopped = true;
    lifetime.abort();
    if (retry !== null) clearTimeout(retry);
    retry = null;
    void observation?.release().catch(() => undefined);
    void workspaceObservation?.release().catch(() => undefined);
    observation = null;
    workspaceObservation = null;
    for (const pill of pills.values()) pill.registration.remove();
    pills.clear();
  };
}
