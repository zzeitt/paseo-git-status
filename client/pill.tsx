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

const RETRY_MIN_MS = 2_000;
const RETRY_MAX_MS = 60_000;

/** The registration is created from the icon, so the icon reaches it here. */
interface RegistrationBox {
  current?: PluginButtonRegistration;
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
  const pills = new Map<
    string,
    { workspaceId: string; registration: PluginButtonRegistration }
  >();
  const lifetime = new AbortController();
  let stopped = false;
  let observation: AgentObservation | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let retryDelay = RETRY_MIN_MS;

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
    pills.set(agentId, { workspaceId, registration: box.current });
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

  function reopen(error: unknown) {
    observation = null;
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
      const result = await client.paseo.agents.list({
        subscribe: {},
        signal: lifetime.signal,
      });
      if (lifetime.signal.aborted) return;
      const subscription = result.subscription;
      if (!subscription) throw new Error("The host returned no agent observation.");
      observation = subscription;
      subscription.subscribe({
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
    observation = null;
    for (const pill of pills.values()) pill.registration.remove();
    pills.clear();
  };
}
