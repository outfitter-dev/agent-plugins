import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  collectSnapshot,
  loadConfig,
  parseLock,
  selectionDigest,
  verifySnapshot,
  type Snapshot,
  type SourceConfig,
  type TreeFile,
} from "./sources.ts";

export function parseArgs(args: string[]): { ref?: string; check: boolean } {
  const options: { ref?: string; check: boolean } = { check: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--check" && !options.check) options.check = true;
    else if (args[i] === "--ref" && !options.ref && args[i + 1] && !args[i + 1]!.startsWith("--"))
      options.ref = args[++i];
    else throw new Error("Usage: bun run upstream:sync [--ref <commit-or-branch>] [--check]");
  }
  return options;
}

async function githubJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(process.env.GH_TOKEN ? { Authorization: `Bearer ${process.env.GH_TOKEN}` } : {}),
    },
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  assert(response.ok, `GitHub metadata request failed (${response.status})`);
  return response.json();
}

export async function downloadSnapshot(config: SourceConfig, ref: string): Promise<Snapshot> {
  const api = `https://api.github.com/repos/${config.repository}`;
  const revision = (await githubJson(`${api}/commits/${encodeURIComponent(ref)}`)) as {
    sha: string;
  };
  assert(/^[a-f0-9]{40}$/.test(revision.sha), "GitHub returned an invalid commit SHA");
  const response = (await githubJson(`${api}/git/trees/${revision.sha}?recursive=1`)) as {
    truncated: boolean;
    tree: Array<{ path: string; type: string; sha: string; size?: number; mode: string }>;
  };
  assert(response.truncated === false && Array.isArray(response.tree), "Incomplete upstream tree");
  const tree: TreeFile[] = response.tree
    .filter((entry) => entry.type === "blob" && entry.path.startsWith(`${config.sourceRoot}/`))
    .map((entry) => ({
      path: entry.path.slice(config.sourceRoot.length + 1),
      sha: entry.sha,
      size: entry.size!,
      mode: entry.mode,
    }));
  return collectSnapshot(config, revision.sha, tree, async (file) => {
    const path = `${config.sourceRoot}/${file.path}`.split("/").map(encodeURIComponent).join("/");
    const response = await fetch(
      `https://raw.githubusercontent.com/${config.repository}/${revision.sha}/${path}`,
      {
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      },
    );
    assert(response.ok, `Upstream download failed (${response.status}): ${file.path}`);
    return new Uint8Array(await response.arrayBuffer());
  });
}

export async function writeSnapshot(
  root: string,
  config: SourceConfig,
  snapshot: Snapshot,
): Promise<void> {
  const destination = resolve(root, config.destination);
  const lockfile = resolve(root, config.lockfile);
  const staging = await mkdtemp(resolve(root, ".refresh-"));
  let backedUp = false;
  let installed = false;
  try {
    for (const [path, bytes] of snapshot.contents) {
      const target = resolve(staging, "content", path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes);
    }
    await writeFile(resolve(staging, "lock.json"), `${JSON.stringify(snapshot.lock, null, 2)}\n`);
    await mkdir(dirname(destination), { recursive: true });
    await mkdir(dirname(lockfile), { recursive: true });
    try {
      await rename(destination, resolve(staging, "previous"));
      backedUp = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await rename(resolve(staging, "content"), destination);
    installed = true;
    await rename(resolve(staging, "lock.json"), lockfile);
  } catch (error) {
    if (installed) await rm(destination, { recursive: true, force: true });
    if (backedUp) await rename(resolve(staging, "previous"), destination);
    throw error;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

export async function sync(
  root: string,
  options: { ref?: string; check: boolean },
): Promise<boolean> {
  const config = await loadConfig(root);
  let ref = options.ref;
  if (!ref) {
    const lock = parseLock(JSON.parse(await readFile(resolve(root, config.lockfile), "utf8")));
    assert(
      lock.selectionSha256 === selectionDigest(config),
      "Selection changed; pass --ref with the intended revision",
    );
    ref = lock.commit;
  }
  const snapshot = await downloadSnapshot(config, ref);
  if (options.check) {
    const lock = await verifySnapshot(root, config);
    const matches = JSON.stringify(lock) === JSON.stringify(snapshot.lock);
    console.log(
      matches
        ? `Upstream matches ${snapshot.lock.commit}`
        : `Upstream differs at ${snapshot.lock.commit}; run upstream:sync --ref ${ref} and review the diff`,
    );
    return matches;
  }
  await writeSnapshot(root, config, snapshot);
  console.log(
    `Synced ${snapshot.lock.files.length} files from ${config.repository}@${snapshot.lock.commit}`,
  );
  return true;
}

if (import.meta.main) {
  try {
    const root = fileURLToPath(new URL("..", import.meta.url));
    if (!(await sync(root, parseArgs(process.argv.slice(2))))) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Upstream refresh failed");
    process.exitCode = 1;
  }
}
