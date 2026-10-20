Git Status puts the current checkout in the Paseo composer. Each agent gets a pill above the message box, so a conversation's worktree and branch stay visible without opening a terminal.

The pill names the worktree first, then the branch. A trailing marker shows uncommitted changes, and ahead/behind counts appear when the branch tracks an upstream. Detached heads show the short commit. Opening the pill shows the full picture:

- The current worktree path and whether it is the main or a linked worktree.
- Every worktree in the repository, with the current one marked.
- The branch, its upstream, and how far it has diverged.
- Staged, unstaged, untracked, and conflicted files, grouped with their status letters.
- The last commit, the stash count, and any merge, rebase, cherry-pick, revert, or bisect in progress.

The plugin reads git locally through the `git` executable on the daemon machine. It does not run write operations, contact a remote, or fetch. Status is refreshed every five seconds while the composer is visible and every three seconds while the popover is open.

The pill is hidden for workspaces Paseo identifies as non-git, and it hides itself if a directory turns out not to be a repository. Git must be installed and available on the daemon's PATH. Paseo 0.11.4 or later is required on the daemon and on the client showing the composer.
