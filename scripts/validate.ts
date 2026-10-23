import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { documentReferences, loadConfig, safePath, verifySnapshot } from "./sources.ts";

export async function validate(root: string): Promise<void> {
  const json = async (path: string) => JSON.parse(await readFile(resolve(root, path), "utf8"));
  const marketplace = await json(".claude-plugin/marketplace.json");
  const catalog = await json(".devin-plugin/plugin.json");
  assert(
    marketplace.name === catalog.name && marketplace.owner?.name,
    "Invalid marketplace identity",
  );
  assert(Array.isArray(marketplace.plugins) && marketplace.plugins.length > 0, "Empty marketplace");
  assert(Array.isArray(catalog.optionalPlugins), "Devin catalog must remain opt-in");
  assert(!catalog.requiredPlugins?.length, "Catalog must not install every plugin automatically");
  assert(catalog.optionalPlugins.length === marketplace.plugins.length, "Catalogs differ");
  const names = new Set<string>();
  for (const entry of marketplace.plugins) {
    assert(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.name), "Invalid plugin name");
    assert(!names.has(entry.name), `Duplicate marketplace plugin: ${entry.name}`);
    names.add(entry.name);
    assert(
      typeof entry.source === "string" && entry.source.startsWith("./plugins/"),
      "Plugin must use a local marketplace directory",
    );
    const pluginPath = safePath(entry.source.slice(2));
    const manifest = await json(`${pluginPath}/.claude-plugin/plugin.json`);
    assert(manifest.name === entry.name, "Plugin manifest differs from marketplace name");
    assert(/^\d+\.\d+\.\d+$/.test(manifest.version), "Missing plugin version");
    assert(
      manifest.description && manifest.author?.name && manifest.license === "Apache-2.0",
      "Incomplete plugin metadata",
    );
    assert(
      catalog.optionalPlugins.some(
        (plugin: { source: string; url: string; path: string }) =>
          plugin.source === "git-subdir" &&
          plugin.url === "https://github.com/outfitter-dev/agent-plugins.git" &&
          plugin.path === pluginPath,
      ),
      "Missing Devin catalog entry",
    );
    await readFile(resolve(root, pluginPath, "LICENSE.txt"));
    await readFile(resolve(root, pluginPath, "THIRD_PARTY_NOTICES.md"));
  }
  const config = await loadConfig(root);
  const lock = await verifySnapshot(root, config);
  const skill = await readFile(
    resolve(root, "plugins/claude-managed-agents/skills/claude-managed-agents/SKILL.md"),
    "utf8",
  );
  assert(
    /^---\nname: claude-managed-agents\ndescription: [^\n]+\nlicense: Apache-2.0\n---\n/.test(
      skill,
    ),
    "Invalid skill frontmatter",
  );
  for (const path of documentReferences(skill, "SKILL.md")) {
    await readFile(
      resolve(
        root,
        "plugins/claude-managed-agents/skills/claude-managed-agents",
        path.startsWith("references/") ? path : `references/anthropic/${path}`,
      ),
    );
  }
  assert(
    lock.files.every((file) => !file.path.endsWith("SKILL.md")),
    "Upstream's broad skill must not be installed",
  );
  console.log(
    `Validated ${names.size} plugin(s), focused skill routing, and ${lock.files.length} pinned source files`,
  );
}

if (import.meta.main) {
  try {
    await validate(fileURLToPath(new URL("..", import.meta.url)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Validation failed");
    process.exitCode = 1;
  }
}
