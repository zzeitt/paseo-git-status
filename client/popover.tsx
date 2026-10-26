import type {
  PluginButtonContentProps,
  PluginClientContext,
} from "@getpaseo/plugin/client";
import { useAgent } from "@getpaseo/plugin/client";
import {
  Icon,
  ScrollView,
} from "@getpaseo/plugin/client/react-native";
import { useMemo, useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import type {
  GitChange,
  GitStatus,
  GitWorktree,
} from "../shared/git-status";
import { isConflicted, resolveGitDirectory } from "../shared/parse";
import {
  enterWorktreePrompt,
  exitWorktreePrompt,
  worktreeAction,
  type WorktreeAction,
  type WorktreeActionInput,
} from "../shared/worktree-action";
import {
  POPOVER_POLL_MS,
  useGitStatus,
  useWorkspaceInfo,
} from "./git-status-query";

const FILE_LIMIT = 30;

type Paseo = PluginClientContext["paseo"];

export function GitStatusPopover(
  props: PluginButtonContentProps & { paseo: Paseo },
) {
  const { theme, layout, workspaceId, paseo } = props;
  const agentId = "agentId" in props ? props.agentId : "";
  const workspace = useWorkspaceInfo(workspaceId);
  const agentCwd = useAgent(agentId, (snapshot) => snapshot.cwd);
  const agentStatus = useAgent(agentId, (snapshot) => snapshot.status);
  const agentProvider = useAgent(agentId, (snapshot) => snapshot.provider);
  const directory =
    resolveGitDirectory(agentCwd, workspace?.directory) ?? undefined;
  const query = useGitStatus(directory, agentId || undefined, POPOVER_POLL_MS);
  const status = query.data;
  const workspaceName = workspace?.title || workspace?.name || "";
  const styles = useMemo(
    () => createStyles(theme, layout.compact),
    [theme, layout.compact],
  );

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {!workspace ? (
          <Text style={styles.muted}>Workspace is loading…</Text>
        ) : !status ? (
          <Text style={styles.muted}>Reading git status…</Text>
        ) : !status.isGit ? (
          <Text style={styles.muted}>Not a git repository.</Text>
        ) : (
          <Body
            status={status}
            workspaceName={workspaceName}
            styles={styles}
            theme={theme}
            agentId={agentId}
            agentStatus={agentStatus}
            provider={agentProvider}
            paseo={paseo}
          />
        )}
        {query.error ? (
          <Text style={styles.error}>{errorText(query.error)}</Text>
        ) : null}
      </ScrollView>
      <View style={styles.footer}>
        <Text style={styles.footerText}>
          {status ? `Updated ${updatedAt(query.dataUpdatedAt)}` : ""}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh git status"
          onPress={() => void query.refetch()}
          hitSlop={8}
        >
          <Text style={styles.refresh}>
            {query.isFetching ? "Refreshing…" : "Refresh"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

type Styles = ReturnType<typeof createStyles>;
type Colors = PluginButtonContentProps["theme"]["colors"];

function Body(props: {
  status: GitStatus;
  workspaceName: string;
  styles: Styles;
  theme: PluginButtonContentProps["theme"];
  agentId: string;
  agentStatus: WorktreeActionInput["agentStatus"];
  provider: string | null;
  paseo: Paseo;
}) {
  const {
    status,
    workspaceName,
    styles,
    theme,
    agentId,
    agentStatus,
    provider,
    paseo,
  } = props;
  const current = status.current;
  const staged = status.changes.filter(
    (change) => !isConflicted(change) && change.index !== ".",
  );
  const unstaged = status.changes.filter(
    (change) => !isConflicted(change) && change.worktree !== ".",
  );
  const conflicts = status.changes.filter(isConflicted);

  return (
    <>
      <View style={styles.header}>
        <View style={styles.headerTitleRow}>
          <Icon
            name="GitBranch"
            size={18}
            color={theme.colors.foregroundMuted}
          />
          <Text style={styles.worktreeName} numberOfLines={1}>
            {current?.name ?? workspaceName}
          </Text>
          {current ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{worktreeBadge(current)}</Text>
            </View>
          ) : null}
        </View>
        {current ? (
          <Text
            style={styles.path}
            selectable
            numberOfLines={2}
            ellipsizeMode="middle"
          >
            {current.path}
          </Text>
        ) : null}
        {status.liveCwd && status.liveCwd !== status.paseoDirectory ? (
          <Text style={styles.mutedSmall} selectable numberOfLines={2}>
            Paseo cwd · {status.paseoDirectory}
          </Text>
        ) : null}
        {workspaceName ? (
          <Text style={styles.mutedSmall}>Paseo workspace · {workspaceName}</Text>
        ) : null}
      </View>

      {status.operation ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>
            ⚠ {operationText(status.operation)} in progress
          </Text>
        </View>
      ) : null}

      {status.error ? <Text style={styles.error}>{status.error}</Text> : null}

      <Section title="Branch" styles={styles}>
        <Text style={styles.value}>
          {current?.branch ??
            (current?.head
              ? `detached at ${current.head.slice(0, 10)}`
              : "(no commits)")}
        </Text>
        {status.upstream ? (
          <Text style={styles.mutedSmall}>
            tracking {status.upstream}
            {divergenceText(status.ahead, status.behind)}
          </Text>
        ) : (
          <Text style={styles.mutedSmall}>No upstream configured</Text>
        )}
      </Section>

      <Section title="Changes" styles={styles}>
        <View style={styles.chips}>
          <CountChip
            label="staged"
            count={status.counts.staged}
            color={theme.colors.statusSuccess}
            styles={styles}
          />
          <CountChip
            label="unstaged"
            count={status.counts.unstaged}
            color={theme.colors.statusWarning}
            styles={styles}
          />
          <CountChip
            label="untracked"
            count={status.counts.untracked}
            color={theme.colors.foregroundMuted}
            styles={styles}
          />
          <CountChip
            label="conflicts"
            count={status.counts.conflicted}
            color={theme.colors.statusDanger}
            styles={styles}
          />
        </View>
        {!status.counts.dirty ? (
          <Text style={styles.mutedSmall}>Working tree clean.</Text>
        ) : null}
        {conflicts.length > 0 ? (
          <FileGroup
            title="Conflicted"
            color={theme.colors.statusDanger}
            files={conflicts.map((change) => ({
              code: `${change.index}${change.worktree}`,
              change,
            }))}
            styles={styles}
          />
        ) : null}
        {staged.length > 0 ? (
          <FileGroup
            title="Staged"
            color={theme.colors.statusSuccess}
            files={staged.map((change) => ({
              code: change.index,
              change,
            }))}
            styles={styles}
          />
        ) : null}
        {unstaged.length > 0 ? (
          <FileGroup
            title="Unstaged"
            color={theme.colors.statusWarning}
            files={unstaged.map((change) => ({
              code: change.worktree,
              change,
            }))}
            styles={styles}
          />
        ) : null}
        {status.untracked.length > 0 ? (
          <FileGroup
            title="Untracked"
            color={theme.colors.foregroundMuted}
            files={status.untracked.map((path) => ({
              code: "?",
              change: { path, index: "?", worktree: "?" },
            }))}
            styles={styles}
          />
        ) : null}
      </Section>

      {status.worktrees.length > 1 ? (
        <Section title="Worktrees" styles={styles}>
          <WorktreeList
            worktrees={status.worktrees}
            agentId={agentId}
            agentStatus={agentStatus}
            provider={provider}
            paseo={paseo}
            styles={styles}
            theme={theme}
          />
        </Section>
      ) : null}

      {status.lastCommit ? (
        <Section title="Last commit" styles={styles}>
          <Text style={styles.value} numberOfLines={2}>
            {status.lastCommit.shortHash} {status.lastCommit.subject}
          </Text>
          <Text style={styles.mutedSmall}>
            {status.lastCommit.author} · {relativeTime(status.lastCommit.date)}
          </Text>
        </Section>
      ) : null}

      {status.stashCount > 0 ? (
        <Text style={styles.mutedSmall}>
          {status.stashCount} stash{status.stashCount === 1 ? "" : "es"}
        </Text>
      ) : null}
    </>
  );
}

/** Worktree rows that can ask this Claude agent to switch checkouts. */
function WorktreeList(props: {
  worktrees: GitWorktree[];
  agentId: string;
  agentStatus: WorktreeActionInput["agentStatus"];
  provider: string | null;
  paseo: Paseo;
  styles: Styles;
  theme: PluginButtonContentProps["theme"];
}) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const [sending, setSending] = useState<string | null>(null);
  // Hover shows the full name on desktop; a tap toggles it on touch devices.
  const [expanded, setExpanded] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    path: string;
    ok: boolean;
    text: string;
  } | null>(null);

  async function run(action: Extract<WorktreeAction, { kind: "enter" | "exit" }>) {
    setSending(action.path);
    setFeedback(null);
    try {
      const text =
        action.kind === "enter"
          ? enterWorktreePrompt(action.path)
          : exitWorktreePrompt();
      await props.paseo.agents.ref(props.agentId).send(text);
      setFeedback({
        path: action.path,
        ok: true,
        text: "Requested — the agent will switch and confirm.",
      });
      setConfirming(null);
    } catch (error) {
      setFeedback({ path: action.path, ok: false, text: errorText(error) });
    } finally {
      setSending(null);
    }
  }

  return (
    <>
      {props.worktrees.map((worktree) => {
        const action = worktreeAction({
          worktree,
          agentStatus: props.agentStatus,
          provider: props.provider,
        });
        const isConfirming = confirming === worktree.path;
        const isSending = sending === worktree.path;
        const showDetail =
          expanded === worktree.path || hovered === worktree.path;
        const rowFeedback =
          feedback?.path === worktree.path ? feedback : null;
        return (
          <View
            key={worktree.path}
            style={props.styles.worktreeBlock}
            onPointerEnter={() => setHovered(worktree.path)}
            onPointerLeave={() =>
              setHovered((value) => (value === worktree.path ? null : value))
            }
          >
            <View style={props.styles.worktreeRow}>
              <Text
                style={[
                  props.styles.worktreeDot,
                  {
                    color: worktree.isCurrent
                      ? props.theme.colors.accent
                      : props.theme.colors.foregroundMuted,
                  },
                ]}
              >
                {worktree.isCurrent ? "●" : "○"}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Show full details for ${worktree.name}`}
                accessibilityHint="Shows the absolute path and the full branch name"
                onPress={() =>
                  setExpanded((value) =>
                    value === worktree.path ? null : worktree.path,
                  )
                }
                style={props.styles.worktreeNames}
              >
                <Text
                  style={
                    worktree.isCurrent
                      ? props.styles.worktreeCurrent
                      : props.styles.worktreeNameRow
                  }
                  numberOfLines={2}
                  ellipsizeMode="middle"
                >
                  {worktree.name}
                </Text>
                <Text
                  style={props.styles.worktreeBranch}
                  numberOfLines={1}
                  ellipsizeMode="middle"
                >
                  {worktree.branch ??
                    (worktree.head ? `@${worktree.head.slice(0, 7)}` : "")}
                </Text>
              </Pressable>
              {worktree.isMain ? (
                <Text style={props.styles.worktreeTag}>main</Text>
              ) : null}
              {action.kind === "blocked" ? (
                <Text style={props.styles.worktreeHint}>
                  {action.reason === "busy" ? "agent running" : "Claude only"}
                </Text>
              ) : action.kind === "none" ? null : isConfirming ? (
                <>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Confirm ${actionLabel(action)} ${worktree.name}`}
                    disabled={sending !== null}
                    onPress={() => void run(action)}
                    hitSlop={6}
                  >
                    <Text
                      style={[
                        props.styles.worktreeAction,
                        isSending && props.styles.worktreeActionMuted,
                      ]}
                    >
                      {isSending ? "Sending…" : "Confirm"}
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Cancel worktree switch"
                    onPress={() => setConfirming(null)}
                    hitSlop={6}
                  >
                    <Text style={props.styles.worktreeHint}>Cancel</Text>
                  </Pressable>
                </>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${actionLabel(action)} ${worktree.name}`}
                  onPress={() => setConfirming(worktree.path)}
                  hitSlop={6}
                >
                  <Text style={props.styles.worktreeAction}>
                    {actionLabel(action)}
                  </Text>
                </Pressable>
              )}
            </View>
            {showDetail ? (
              <View style={props.styles.worktreeDetail}>
                <Text
                  style={props.styles.worktreeDetailText}
                  selectable
                  numberOfLines={3}
                >
                  {worktree.path}
                </Text>
                <Text
                  style={props.styles.worktreeDetailText}
                  selectable
                  numberOfLines={2}
                >
                  {worktree.branch
                    ? `branch ${worktree.branch}`
                    : worktree.head
                      ? `detached at ${worktree.head}`
                      : "no commits"}
                </Text>
              </View>
            ) : null}
            {rowFeedback ? (
              <Text
                style={
                  rowFeedback.ok
                    ? props.styles.mutedSmall
                    : props.styles.error
                }
              >
                {rowFeedback.text}
              </Text>
            ) : null}
          </View>
        );
      })}
    </>
  );
}

function actionLabel(action: WorktreeAction): string {
  return action.kind === "exit" ? "Exit" : "Enter";
}

function Section(props: {
  title: string;
  styles: Styles;
  children: ReactNode;
}) {
  return (
    <View style={props.styles.section}>
      <Text style={props.styles.sectionTitle}>{props.title}</Text>
      {props.children}
    </View>
  );
}

function CountChip(props: {
  label: string;
  count: number;
  color: string;
  styles: Styles;
}) {
  const muted = props.count === 0;
  return (
    <View style={[props.styles.chip, muted && props.styles.chipMuted]}>
      <Text
        style={[
          props.styles.chipText,
          { color: muted ? props.styles.chipMutedText.color : props.color },
        ]}
      >
        {props.count} {props.label}
      </Text>
    </View>
  );
}

function FileGroup(props: {
  title: string;
  color: string;
  files: { code: string; change: GitChange }[];
  styles: Styles;
}) {
  const shown = props.files.slice(0, FILE_LIMIT);
  const rest = props.files.length - shown.length;
  return (
    <View style={props.styles.fileGroup}>
      <Text style={props.styles.fileGroupTitle}>{props.title}</Text>
      {shown.map(({ code, change }) => (
        <View key={`${change.path}:${code}`} style={props.styles.fileRow}>
          <Text style={[props.styles.fileCode, { color: props.color }]}>
            {code}
          </Text>
          <Text
            style={props.styles.filePath}
            numberOfLines={1}
            ellipsizeMode="middle"
          >
            {change.origPath
              ? `${change.origPath} → ${change.path}`
              : change.path}
          </Text>
        </View>
      ))}
      {rest > 0 ? (
        <Text style={props.styles.mutedSmall}>…and {rest} more</Text>
      ) : null}
    </View>
  );
}

function worktreeBadge(worktree: GitWorktree): string {
  if (worktree.bare) return "bare";
  return worktree.isMain ? "main worktree" : "linked worktree";
}

function operationText(operation: NonNullable<GitStatus["operation"]>): string {
  switch (operation) {
    case "merge":
      return "Merge";
    case "rebase":
      return "Rebase";
    case "cherry-pick":
      return "Cherry-pick";
    case "revert":
      return "Revert";
    case "bisect":
      return "Bisect";
  }
}

function divergenceText(
  ahead: number | null,
  behind: number | null,
): string {
  if (ahead === null && behind === null) return "";
  if (!ahead && !behind) return " · up to date";
  const parts = [
    ahead ? `↑${ahead}` : "",
    behind ? `↓${behind}` : "",
  ].filter(Boolean);
  return ` · ${parts.join(" ")}`;
}

function relativeTime(iso: string): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return iso;
  const seconds = Math.max(0, Math.round((Date.now() - time) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(time).toLocaleDateString();
}

function updatedAt(timestamp: number): string {
  if (!timestamp) return "never";
  return new Date(timestamp).toLocaleTimeString();
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createStyles(
  theme: PluginButtonContentProps["theme"],
  compact: boolean,
) {
  const colors: Colors = theme.colors;
  return {
    root: {
      minWidth: compact ? undefined : 320,
      maxWidth: compact ? undefined : 460,
    },
    scroll: { maxHeight: compact ? 420 : 480 },
    content: { padding: compact ? 14 : 16, gap: 14 },
    header: { gap: 4 },
    headerTitleRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 8,
    },
    worktreeName: {
      color: colors.foreground,
      fontSize: 16,
      fontWeight: "600" as const,
      flexShrink: 1,
    },
    badge: {
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 6,
      backgroundColor: colors.surface2,
    },
    badgeText: { color: colors.foregroundMuted, fontSize: 10 },
    path: { color: colors.foregroundMuted, fontSize: 11 },
    muted: { color: colors.foregroundMuted, fontSize: 12 },
    mutedSmall: { color: colors.foregroundMuted, fontSize: 11 },
    value: { color: colors.foreground, fontSize: 13 },
    error: { color: colors.statusDanger, fontSize: 12 },
    banner: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 6,
      padding: 8,
      borderRadius: 8,
      backgroundColor: colors.surface2,
    },
    bannerText: { color: colors.statusWarning, fontSize: 12 },
    section: { gap: 5 },
    sectionTitle: {
      color: colors.foregroundMuted,
      fontSize: 10,
      fontWeight: "600" as const,
      textTransform: "uppercase" as const,
      letterSpacing: 0.5,
    },
    chips: {
      flexDirection: "row" as const,
      flexWrap: "wrap" as const,
      gap: 6,
    },
    chip: {
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 999,
      backgroundColor: colors.surface2,
    },
    chipMuted: { opacity: 0.55 },
    chipText: { fontSize: 11 },
    chipMutedText: { color: colors.foregroundMuted },
    fileGroup: { gap: 2, marginTop: 4 },
    fileGroupTitle: { color: colors.foregroundMuted, fontSize: 11 },
    fileRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 6,
    },
    fileCode: {
      fontSize: 11,
      fontFamily: "monospace",
      width: 26,
    },
    filePath: { color: colors.foreground, fontSize: 11, flexShrink: 1 },
    worktreeBlock: { gap: 2 },
    worktreeRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 6,
    },
    worktreeNames: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 6,
      flexShrink: 1,
      flexGrow: 1,
    },
    worktreeDetail: { gap: 1, paddingLeft: 18, paddingVertical: 2 },
    worktreeDetailText: { color: colors.foregroundMuted, fontSize: 10 },
    worktreeDot: { fontSize: 10, width: 12, textAlign: "center" as const },
    worktreeCurrent: {
      color: colors.foreground,
      fontSize: 12,
      fontWeight: "600" as const,
      flexShrink: 1,
    },
    worktreeNameRow: {
      color: colors.foregroundMuted,
      fontSize: 12,
      flexShrink: 1,
    },
    worktreeBranch: { color: colors.foregroundMuted, fontSize: 11, flexShrink: 1 },
    worktreeTag: {
      color: colors.foregroundMuted,
      fontSize: 9,
      paddingHorizontal: 5,
      paddingVertical: 1,
      borderRadius: 4,
      backgroundColor: colors.surface2,
    },
    worktreeHint: { color: colors.foregroundMuted, fontSize: 10 },
    worktreeAction: {
      color: colors.accent,
      fontSize: 11,
      fontWeight: "600" as const,
    },
    worktreeActionMuted: { opacity: 0.6 },
    footer: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "space-between" as const,
      paddingHorizontal: compact ? 14 : 16,
      paddingVertical: 10,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      backgroundColor: colors.surface1,
    },
    footerText: { color: colors.foregroundMuted, fontSize: 10 },
    refresh: { color: colors.accent, fontSize: 11, fontWeight: "600" as const },
  };
}
