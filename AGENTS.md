# Agent Plugins

- Author local skill instructions in `plugins/*/skills/*/SKILL.md`.
- `references/anthropic/` is an unmodified upstream snapshot. Change source selection in `sources.json`, then run `bun run upstream:sync --ref <commit-or-branch>`; do not edit the snapshot by hand.
- `bun run upstream:sync` without `--ref` restores the locked commit. An explicit `--ref main` opts into newer upstream instructions. Review their diff before merging.
- Upstream refreshes copy files only. Do not execute imported scripts as part of validation or refresh.
- A merge to the default branch releases Git-backed plugin content to future sessions. Publishing code does not authorize changing managed plugin installations.
