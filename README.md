# Outfitter Agent Plugins

Focused plugins for coding agents, with reproducible copies of upstream reference material. This is an independent community marketplace, not an Anthropic product.

## Plugins

| Plugin                                           | Purpose                                                             |
| ------------------------------------------------ | ------------------------------------------------------------------- |
| [managed-agents](plugins/claude-managed-agents/) | Build and operate integrations with Anthropic Claude Managed Agents |

Each plugin is self-contained under `plugins/<name>/`. The repository root is a catalog, not an instruction bundle. Adding a plugin to the catalog does not make it mandatory for every Devin session.

## Install

### Devin

In **Customize → Plugins → Add plugin → From repository**, use:

- Repository: `outfitter-dev/agent-plugins`
- Subdirectory: `plugins/claude-managed-agents`
- Scope: choose personal or organization intentionally.

Direct plugin URL: <https://github.com/outfitter-dev/agent-plugins/tree/main/plugins/claude-managed-agents>.

Devin loads the plugin's Claude-format manifest directly. Installing the repository root instead adds the opt-in Devin catalog; it does **not** automatically install its optional plugins. See [Devin's plugin ecosystem guide](https://docs.devin.ai/product-guides/plugin-ecosystem).

If replacing an uploaded copy of this skill, install and verify the Git-backed plugin, then remove the uploaded copy. Do not keep both enabled: they have different identities and can expose duplicate skills. This repository does not change managed installations itself.

### Claude Code

```text
/plugin marketplace add outfitter-dev/agent-plugins
/plugin install managed-agents@outfitter-agent-plugins
```

The skill is available as `/managed-agents:claude-managed-agents` and through matching requests. The plugin's registered name is `managed-agents`: Claude Code reserves `claude-*` plugin names for Anthropic. The folder and skill remain `claude-managed-agents`. To try a checkout without installing it:

```sh
claude --plugin-dir ./plugins/claude-managed-agents
```

See [Claude Code's marketplace documentation](https://code.claude.com/docs/en/plugin-marketplaces).

## What's included

The plugin has one original routing skill, not a wholesale installation of Anthropic's broad `claude-api` skill. It routes Managed Agents tasks to selected official guides, onboarding flows, Console quickstarts, and examples for TypeScript, Python, Go, Java, PHP, Ruby, and raw HTTP (also the wire-level fallback for C#).

`sources.json` selects:

- `shared/managed-agents-*.md` and the quickstart directory;
- each language's Managed Agents reference and the cURL guide;
- CLI, agent design, live-source pointers, AWS platform guidance, models, availability, errors, and the original license;
- the transitive local-document dependencies of those sources.

The dependency closure includes some broader API and eval references plus upstream helper scripts. They stay dormant unless needed; refresh and CI never execute imported code. The upstream full eval report builder is absent from Anthropic's published tree; its existing lite fallback is bundled, and that single optional reference is explicit in `sources.json`.

Unrelated skills such as `mcp-builder`, `skill-creator`, and document-generation skills are not installed. There are no always-on rules, runtime hooks, MCP servers, credentials, or API calls in this plugin. It provides development guidance, not Managed Agents access.

## Develop and validate

Use the Bun version in `.bun-version`:

```sh
bun install --frozen-lockfile
bun run hooks:install
bun run ci
```

`ci` is the same command locally, in the pre-commit hook, and in GitHub Actions: type checking, lint, formatting, package/source validation, and tests. Tests use fixtures and mocked GitHub responses; normal CI is offline after dependency installation. Vendored sources are excluded from formatting and linting so their bytes remain identical to upstream.

For a native Claude Code packaging check, when its CLI is available:

```sh
claude plugin validate .
claude plugin validate ./plugins/claude-managed-agents
```

Repository validation checks the supported packaging fields and all router paths, but is not a replacement for a live harness activation test. Try a request such as “Implement Managed Agents SSE reconnect handling in TypeScript”: it should load the overview, events/client-patterns guides, and TypeScript reference. Ordinary Messages API requests and Claude Code plugin authoring should not activate this skill. No paid Managed Agents run is needed to test routing.

## Refresh upstream material

```sh
# Check the vendored bytes and source lock locally, without network access.
bun run validate

# Compare upstream main without changing files (exit 1 means drift).
bun run upstream:status

# Deliberately refresh, including newly referenced local documents.
bun run upstream:sync --ref main

# Or pin a reviewed upstream revision explicitly.
bun run upstream:sync --ref <full-commit-sha>

# Reproduce/restore the currently locked revision, never floating main.
bun run upstream:sync

bun run ci
```

The source lock lives inside the skill's `references/` directory, so it ships with the plugin. It records a full upstream commit, selection digest, original paths, Git blob identities, byte sizes, SHA-256 hashes, and whether each file was directly selected or included as a dependency. Source bytes and license terms are preserved without rewriting. The copier resolves a branch once, uses only that commit for all downloads, verifies Git blob hashes, stages the complete selection before replacing the old copy, and removes obsolete files. Download or validation failures leave the previous snapshot intact.

Changing source selection requires an explicit `--ref`. A changed upstream license fails closed until a maintainer reviews the license and deliberately updates its expected digest. Missing required references and unexpectedly large selections also fail rather than silently producing a partial bundle. `GH_TOKEN` is optional for public downloads and is sent only to GitHub's API metadata endpoint, never copied into plugin content.

The refresh workflow runs Mondays at 09:23 UTC or by manual dispatch, validates the result, then opens or updates one refresh PR. It uses the repository's `GITHUB_TOKEN`, not a personal credential. GitHub must permit Actions to create PRs. No auto-merge, automatic plugin installation, or model/API execution is configured. GitHub suppresses additional workflow triggers for PRs created with `GITHUB_TOKEN`; the refresh job runs the full checks before opening the PR. If branch protection requires a separate CI status on that commit, manually dispatch CI on the refresh branch.

Review refreshed instructions and dependencies, not just checksums. Merging to the default branch releases Git-backed plugin content to future sessions; bump the plugin version for intentional releases. A lock pins the bundled content, not the live API: the skill points agents to current official documentation when SDK or feature details differ.

## License

Apache-2.0. See `LICENSE` and each plugin's `THIRD_PARTY_NOTICES.md`. Selected Anthropic files retain their original license, paths, and attribution.
