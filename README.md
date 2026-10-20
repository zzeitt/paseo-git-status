# paseo-git-status

A [Paseo](https://paseo.sh) plugin that puts the current git status in the composer, beside Tasks, Subagents, and the other composer pills.

The pill is registered per agent, so it answers the question that matters while a conversation is open: which worktree and branch is this session working in?

- The label names the git worktree first, then the branch. `*` means uncommitted changes, `!` means conflicts, and `↑n↓m` shows divergence from the upstream.
- Non-git workspaces hide the pill.
- The popover shows the current worktree path and whether it is the main or a linked worktree, every worktree in the repository, branch and upstream state, staged/unstaged/untracked/conflicted files, the last commit, the stash count, and any merge, rebase, cherry-pick, revert, or bisect in progress.
- Status is polled every five seconds while the composer is visible and every three seconds while the popover is open. The plugin only reads git state; it never runs write operations and makes no network requests.

## Requirements

- Paseo 0.12.0 or later on the daemon.
- `git` available on the daemon's `PATH`.

## Install

Install directly from this repository:

```bash
paseo plugin add git:zzeitt/paseo-git-status
```

Pin a revision with `--ref`, and target another daemon with `--host`:

```bash
paseo plugin add git:zzeitt/paseo-git-status --ref v0.1.0 --host <host>
```

If HTTPS access to GitHub is blocked, or the daemon host routes Git HTTPS through an unavailable proxy, install from the SSH URL instead:

```bash
paseo plugin add git@github.com:zzeitt/paseo-git-status.git
```

SSH requires a GitHub SSH key on the daemon host.

Then reload the app if the composer does not show the pill immediately.

## Development

```bash
npm install
npm run typecheck
npm test
```

To try a local checkout in the daemon on this machine:

```bash
paseo plugin install /absolute/path/to/paseo-git-status
paseo plugin reload paseo-git-status
```

The plugin entry points are `index.client.tsx` and `index.server.ts`. The daemon-side RPC is `gitstatus.get` in `shared/git-status.ts`; it runs `git worktree list --porcelain`, `git status --porcelain=v2 --branch -z`, `git log -1`, and `git stash list` in the agent's workspace directory.

## License

MIT
