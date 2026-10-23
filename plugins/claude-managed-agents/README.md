# Claude Managed Agents

One focused skill for building integrations with Anthropic's hosted Managed Agents API: agents, sessions, environments, tools, MCP, vaults, event streams, memory, multiagent workflows, outcomes, and scheduled deployments.

Install in Claude Code (2.1.275 or later):

```text
/plugin install managed-agents --marketplace outfitter-dev/agent-plugins
```

- **Skill:** `skills/claude-managed-agents/SKILL.md`
- **References:** `skills/claude-managed-agents/references/anthropic/`
- **Provenance:** `skills/claude-managed-agents/references/upstream.lock.json`

The plugin is registered as `managed-agents` because Claude Code reserves `claude-*` plugin names for Anthropic; the folder and skill are still `claude-managed-agents`. Its Claude-format manifest also loads in Devin. No runtime tools, accounts, secrets, or services are required to read it. Actual API work requires your own Managed Agents access and approved credentials; installing the plugin does not authorize remote actions or paid runs.

References are selected from Anthropic's `claude-api` skill, copied unmodified, and loaded only when needed. The original broad skill is not installed. Paths inside upstream documents are relative to the `references/anthropic/` directory. Supporting documentation and helper scripts are included when upstream references need them; the refresh workflow never executes those helpers.

See the [marketplace README](../../README.md) for installation, validation, source selection, and refresh commands. The plugin folder is the independently installable unit; it does not need the marketplace's development scripts at runtime.

See [third-party notices](THIRD_PARTY_NOTICES.md) and [Apache-2.0](LICENSE.txt).
