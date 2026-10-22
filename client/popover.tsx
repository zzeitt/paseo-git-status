import type { PluginButtonContentProps } from "@getpaseo/plugin/client";
import { useAgent } from "@getpaseo/plugin/client";
import {
  Icon,
  ScrollView,
} from "@getpaseo/plugin/client/react-native";
import { useMemo, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import type {
  GitChange,
  GitStatus,
  GitWorktree,
} from "../shared/git-status";
import { isConflicted, resolveGitDirectory } from "../shared/parse";
import {
  POPOVER_POLL_MS,
  useGitStatus,
  useWorkspaceInfo,
} from "./git-status-query";

const FILE_LIMIT = 30;

export function GitStatusPopover(props: PluginButtonContentProps) {
  const { theme, layout, workspaceId } = props;
  const agentId = "agentId" in props ? props.agentId : "";
  const workspace = useWorkspaceInfo(workspaceId);
  const agentCwd = useAgent(agentId, (snapshot) => snapshot.cwd);
  const directory =
    resolveGitDirectory(agentCwd, workspace?.directory) ?? undefined;
  const query = useGitStatus(directory, POPOVER_POLL_MS);
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
          <Body status={status} workspaceName={workspaceName} styles={styles} theme={theme} />
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
}) {
  const { status, workspaceName, styles, theme } = props;
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
          <Text style={styles.path} selectable numberOfLines={2}>
            {current.path}
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
          {status.worktrees.map((worktree) => (
            <View key={worktree.path} style={styles.worktreeRow}>
              <Text
                style={[
                  styles.worktreeDot,
                  {
                    color: worktree.isCurrent
                      ? theme.colors.accent
                      : theme.colors.foregroundMuted,
                  },
                ]}
              >
                {worktree.isCurrent ? "●" : "○"}
              </Text>
              <Text
                style={
                  worktree.isCurrent
                    ? styles.worktreeCurrent
                    : styles.worktreeNameRow
                }
                numberOfLines={1}
              >
                {worktree.name}
              </Text>
              <Text style={styles.worktreeBranch} numberOfLines={1}>
                {worktree.branch ??
                  (worktree.head ? `@${worktree.head.slice(0, 7)}` : "")}
              </Text>
              {worktree.isMain ? (
                <Text style={styles.worktreeTag}>main</Text>
              ) : null}
            </View>
          ))}
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
    worktreeRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 6,
    },
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
