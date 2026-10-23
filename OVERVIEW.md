Git Status puts the current checkout in the Paseo composer. Each agent gets a pill above the message box, so a conversation's worktree and branch stay visible without opening a terminal.

The pill names the worktree first, then the branch. A trailing marker shows uncommitted changes, and ahead/behind counts appear when the branch tracks an upstream. Detached heads show the short commit. Opening the pill shows the full picture:

- The current worktree path and whether it is the main or a linked worktree.
- Every worktree in the repository, with the current one marked.
- The branch, its upstream, and how far it has diverged.
- Staged, unstaged, untracked, and conflicted files, grouped with their status letters.
- The last commit, the stash count, and any merge, rebase, cherry-pick, revert, or bisect in progress.

The pill follows the live session directory. Paseo records an agent's cwd when it is created; after a Claude agent enters or leaves a worktree with EnterWorktree or ExitWorktree, the daemon reads the current directory from the session transcript instead. The popover shows Paseo's recorded directory when the two differ.

Clicking a worktree row offers to switch: Enter asks the agent to call EnterWorktree for a linked worktree, Exit asks for ExitWorktree back to the main one. The plugin sends a normal user message, so the switch is visible in the conversation and costs one turn. A second click confirms, and the action is only offered for an idle Claude agent.

The plugin reads git locally through the `git` executable on the daemon machine. It does not run git write operations, contact a remote, or fetch. Status is refreshed every five seconds while the composer is visible and every three seconds while the popover is open.

The pill is hidden for workspaces Paseo identifies as non-git, and it hides itself if a directory turns out not to be a repository. Git must be installed and available on the daemon's PATH. Paseo 0.11.4 or later is required on the daemon and on the client showing the composer.
