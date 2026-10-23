import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { posix, resolve } from "node:path";

export interface SourceConfig {
  repository: string;
  sourceRoot: string;
  destination: string;
  lockfile: string;
  include: string[];
  support: string[];
  optionalReferences: string[];
  licenseSha256: string;
}

export interface SourceFile {
  path: string;
  sha256: string;
  gitBlobSha1: string;
  bytes: number;
  reason: "selected" | "dependency";
}

export interface SourceLock {
  schemaVersion: 1;
  repository: string;
  sourceRoot: string;
  commit: string;
  selectionSha256: string;
  files: SourceFile[];
}

export interface TreeFile {
  path: string;
  sha: string;
  size: number;
  mode: string;
}

export interface Snapshot {
  lock: SourceLock;
  contents: Map<string, Uint8Array>;
}

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function gitBlobSha1(value: Uint8Array): string {
  return createHash("sha1").update(`blob ${value.length}\0`).update(value).digest("hex");
}

export function safePath(path: string): string {
  assert(path.length > 0 && !path.startsWith("/"), `Not a relative path: ${path}`);
  assert(!path.includes("\\") && !path.includes("\0"), `Invalid path: ${path}`);
  assert(
    path.split("/").every((part) => part && part !== "." && part !== ".."),
    `Unsafe path: ${path}`,
  );
  return path;
}

export function parseConfig(value: unknown): SourceConfig {
  assert(value && typeof value === "object", "sources.json must be an object");
  const config = value as SourceConfig;
  assert(/^[\w.-]+\/[\w.-]+$/.test(config.repository), "Invalid GitHub repository");
  for (const key of ["sourceRoot", "destination", "lockfile"] as const) safePath(config[key]);
  assert(config.destination.startsWith("plugins/"), "Destination must be inside plugins/");
  assert(config.lockfile.startsWith("plugins/"), "Lock must be inside plugins/");
  assert(
    !config.lockfile.startsWith(`${config.destination}/`),
    "Lock must be outside the snapshot",
  );
  assert(config.lockfile !== config.destination, "Lock and destination must differ");
  for (const key of ["include", "support", "optionalReferences"] as const) {
    assert(Array.isArray(config[key]), `Missing ${key} list`);
    for (const path of config[key]) safePath(path);
  }
  assert(
    config.include.length > 0 && config.support.includes("LICENSE.txt"),
    "Missing source selection or license",
  );
  assert(/^[a-f0-9]{64}$/.test(config.licenseSha256), "Invalid license digest");
  return config;
}

export async function loadConfig(root: string): Promise<SourceConfig> {
  return parseConfig(JSON.parse(await readFile(resolve(root, "sources.json"), "utf8")));
}

export function parseLock(value: unknown): SourceLock {
  assert(value && typeof value === "object", "Source lock must be an object");
  const lock = value as SourceLock;
  assert(lock.schemaVersion === 1, "Unsupported source lock version");
  assert(/^[a-f0-9]{40}$/.test(lock.commit), "Lock must pin a full commit SHA");
  assert(/^[a-f0-9]{64}$/.test(lock.selectionSha256), "Invalid selection digest");
  assert(Array.isArray(lock.files) && lock.files.length > 0, "Empty source lock");
  const paths = new Set<string>();
  for (const file of lock.files) {
    safePath(file.path);
    assert(!paths.has(file.path), `Duplicate lock entry: ${file.path}`);
    paths.add(file.path);
    assert(/^[a-f0-9]{64}$/.test(file.sha256), `Invalid digest: ${file.path}`);
    assert(/^[a-f0-9]{40}$/.test(file.gitBlobSha1), `Invalid blob identity: ${file.path}`);
    assert(Number.isSafeInteger(file.bytes) && file.bytes >= 0, `Invalid size: ${file.path}`);
    assert(
      ["selected", "dependency"].includes(file.reason),
      `Invalid selection reason: ${file.path}`,
    );
  }
  return lock;
}

export function selectionDigest(config: SourceConfig): string {
  return sha256(JSON.stringify(config));
}

export function selectPaths(config: SourceConfig, available: Set<string>): Set<string> {
  const selected = new Set(config.support);
  for (const pattern of config.include) {
    const matches = [...available].filter((path) => new Bun.Glob(pattern).match(path));
    assert(matches.length > 0, `Source pattern no longer matches anything: ${pattern}`);
    for (const path of matches) selected.add(path);
  }
  for (const path of selected) assert(available.has(path), `Missing selected source: ${path}`);
  return selected;
}

export function documentReferences(text: string, path: string): Set<string> {
  const references = new Set<string>();
  const withoutUrls = text.replace(/https?:\/\/[^\s)<>`]+/g, "");
  for (const match of withoutUrls.matchAll(
    /\b(?:shared|python|typescript|curl|go|java|php|ruby|csharp)\/[\w/.-]+\.(?:md|py|mjs|json|ts)\b/g,
  )) {
    references.add(safePath(match[0]));
  }
  for (const match of text.matchAll(/\]\(([^\s)]+)\)/g)) {
    const target = match[1]!.split("#")[0]!;
    if (!/\.(?:md|py|mjs|json|ts)$/.test(target) || /^[a-z]+:/i.test(target)) continue;
    references.add(safePath(posix.normalize(posix.join(posix.dirname(path), target))));
  }
  return references;
}

export async function collectSnapshot(
  config: SourceConfig,
  commit: string,
  tree: TreeFile[],
  read: (file: TreeFile) => Promise<Uint8Array>,
): Promise<Snapshot> {
  assert(/^[a-f0-9]{40}$/.test(commit), "Expected a full commit SHA");
  const index = new Map<string, TreeFile>();
  for (const file of tree) {
    safePath(file.path);
    assert(!index.has(file.path), `Duplicate upstream path: ${file.path}`);
    index.set(file.path, file);
  }
  const selected = selectPaths(config, new Set(index.keys()));
  const pending = new Set(selected);
  const contents = new Map<string, Uint8Array>();
  let bytes = 0;
  while (pending.size > 0) {
    const batch = [...pending].sort().slice(0, 6);
    const downloaded = await Promise.all(
      batch.map(async (path) => {
        const file = index.get(path);
        assert(file, `Missing referenced source: ${path}`);
        assert(["100644", "100755"].includes(file.mode), `Not a regular upstream file: ${path}`);
        assert(file.size <= 2_000_000, `Upstream file too large: ${path}`);
        const data = await read(file);
        assert(
          data.length === file.size && gitBlobSha1(data) === file.sha,
          `Upstream blob mismatch: ${path}`,
        );
        return { path, data };
      }),
    );
    for (const { path, data } of downloaded) {
      pending.delete(path);
      contents.set(path, data);
      bytes += data.length;
      assert(bytes <= 16_000_000, "Upstream selection exceeds 16 MB; review source selection");
      if (!path.endsWith(".md")) continue;
      const text = new TextDecoder("utf-8", { fatal: true }).decode(data);
      for (const dependency of documentReferences(text, path)) {
        if (config.optionalReferences.includes(dependency) && !index.has(dependency)) continue;
        assert(index.has(dependency), `Missing referenced source: ${path} -> ${dependency}`);
        if (!contents.has(dependency)) pending.add(dependency);
      }
    }
  }
  assert(
    sha256(contents.get("LICENSE.txt")!) === config.licenseSha256,
    "Upstream license changed; review before updating its expected digest",
  );
  const files = [...contents]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, data]): SourceFile => ({
      path,
      sha256: sha256(data),
      gitBlobSha1: index.get(path)!.sha,
      bytes: data.length,
      reason: selected.has(path) ? "selected" : "dependency",
    }));
  return {
    lock: {
      schemaVersion: 1,
      repository: config.repository,
      sourceRoot: config.sourceRoot,
      commit,
      selectionSha256: selectionDigest(config),
      files,
    },
    contents,
  };
}

export async function listFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  async function visit(relative: string): Promise<void> {
    for (const entry of await readdir(resolve(directory, relative), { withFileTypes: true })) {
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      assert(!entry.isSymbolicLink(), `Symlink not allowed in snapshot: ${path}`);
      if (entry.isDirectory()) await visit(path);
      else {
        assert(entry.isFile(), `Not a regular snapshot file: ${path}`);
        files.push(path);
      }
    }
  }
  await visit("");
  return files.sort();
}

export async function verifySnapshot(root: string, config: SourceConfig): Promise<SourceLock> {
  const lock = parseLock(JSON.parse(await readFile(resolve(root, config.lockfile), "utf8")));
  assert(
    lock.repository === config.repository && lock.sourceRoot === config.sourceRoot,
    "Source identity differs from lock",
  );
  assert(
    lock.selectionSha256 === selectionDigest(config),
    "sources.json changed; regenerate the snapshot",
  );
  const directory = resolve(root, config.destination);
  assert.deepEqual(
    await listFiles(directory),
    lock.files.map((file) => file.path).sort(),
    "Snapshot file inventory differs from lock",
  );
  const available = new Set(lock.files.map((file) => file.path));
  selectPaths(config, available);
  for (const file of lock.files) {
    const data = await readFile(resolve(directory, file.path));
    assert(
      data.length === file.bytes &&
        sha256(data) === file.sha256 &&
        gitBlobSha1(data) === file.gitBlobSha1,
      `Snapshot content changed: ${file.path}`,
    );
    if (!file.path.endsWith(".md")) continue;
    for (const dependency of documentReferences(data.toString("utf8"), file.path)) {
      assert(
        available.has(dependency) || config.optionalReferences.includes(dependency),
        `Unbundled reference: ${file.path} -> ${dependency}`,
      );
    }
  }
  assert(
    sha256(await readFile(resolve(directory, "LICENSE.txt"))) === config.licenseSha256,
    "License digest mismatch",
  );
  return lock;
}
