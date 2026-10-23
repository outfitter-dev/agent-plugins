---
name: claude-managed-agents
description: Build, debug, or review integrations with Anthropic Claude Managed Agents, including persisted agents, sessions, environments, events, tools, vaults, memory, multiagent workflows, and scheduled deployments; not for Claude Code plugins, the Agent SDK, or ordinary Messages API integrations.
license: Apache-2.0
---

# Claude Managed Agents

Use this skill when the task concerns Anthropic's hosted Managed Agents API. It teaches the coding agent how to build integrations; installing it does not create a Managed Agent or grant API access.

## Orient

1. Identify the requested behavior and the project's language. Do not ask for a language that the project already establishes.
2. Read [the Managed Agents overview](references/anthropic/shared/managed-agents-overview.md).
3. Read the task guide and language reference from the tables. Load additional references only when the task needs them.

The upstream references preserve their original paths. Within an upstream document, a path such as `shared/managed-agents-core.md` is relative to `references/anthropic/`, not to the repository where you are working. Upstream mentions of its original `SKILL.md`, language detection, or `/claude-api` entrypoint refer to Anthropic's broader skill: use this skill's routing instead.

## Choose the task guide

All paths in this table are under `references/anthropic/`.

| Task                                                  | Read                                                                                                                                             |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| First integration or setup from a description         | `shared/managed-agents-onboarding.md`                                                                                                            |
| Setup from a URL or a Console quickstart              | `shared/managed-agents-onboarding-from-url.md` or `shared/managed-agents-onboarding-from-quickstart.md`; the latter selects a bundled quickstart |
| Agent versions, sessions, overrides, budgets          | `shared/managed-agents-core.md`                                                                                                                  |
| Tools, permissions, MCP, vaults, credentials, skills  | `shared/managed-agents-tools.md`                                                                                                                 |
| Streaming, reconnects, confirmations, client patterns | `shared/managed-agents-events.md` and `shared/managed-agents-client-patterns.md`                                                                 |
| Webhooks                                              | `shared/managed-agents-webhooks.md`                                                                                                              |
| Environments, networking, repositories, files         | `shared/managed-agents-environments.md`                                                                                                          |
| Self-hosted sandboxes                                 | `shared/managed-agents-self-hosted-sandboxes.md`                                                                                                 |
| Persistent memory                                     | `shared/managed-agents-memory.md`                                                                                                                |
| Multiple agents, threads, advisors, dynamic workflows | `shared/managed-agents-multiagent.md`                                                                                                            |
| Outcomes and rubric-based iteration                   | `shared/managed-agents-outcomes.md`                                                                                                              |
| Scheduled deployments                                 | `shared/managed-agents-scheduled-deployments.md`                                                                                                 |
| Version-controlled definitions and `ant apply`        | `shared/anthropic-cli.md`                                                                                                                        |
| API shapes or current documentation                   | `shared/managed-agents-api-reference.md` and `shared/live-sources.md`                                                                            |

## Choose the language reference

| Language                | Path under `references/anthropic/`                                    |
| ----------------------- | --------------------------------------------------------------------- |
| TypeScript / JavaScript | `typescript/managed-agents/README.md`                                 |
| Python                  | `python/managed-agents/README.md`                                     |
| Go                      | `go/managed-agents/README.md`                                         |
| Java                    | `java/managed-agents/README.md`                                       |
| PHP                     | `php/managed-agents/README.md`                                        |
| Ruby                    | `ruby/managed-agents/README.md`                                       |
| cURL / raw HTTP / C#    | `curl/managed-agents.md` (wire-level reference, not a C# SDK example) |

## Apply the guidance

- Separate persisted Agent setup from per-run Session creation. Reuse the Agent ID; pin its version when reproducibility is required.
- Before starting a session, reconcile its tools, credentials, resource mounts, and network access with the requested task.
- Keep credentials in the project's approved secret store or Managed Agents vaults, not in plugin files or committed examples.
- Ask before installing a CLI, provisioning remote resources, or starting a run that spends money. Writing example code alone does not authorize execution.

## Check freshness

The bundled references are a reviewed snapshot, not a live API contract. [The source lock](references/upstream.lock.json) records the upstream commit and each file's digest. When a task depends on current SDK fields, beta headers, feature availability, or an error that contradicts the snapshot, check the installed SDK/CLI and the official sources listed in `references/anthropic/shared/live-sources.md`. Report a material mismatch rather than silently rewriting the bundled documents.

Supporting files are included transitively when the Managed Agents guides refer to them. They do not broaden this skill's activation to general Messages API, model migration, or eval work. Upstream's full eval report builder is optional; its bundled lite builder is the documented fallback.
