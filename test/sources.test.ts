import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  collectSnapshot,
  documentReferences,
  gitBlobSha1,
  listFiles,
  parseConfig,
  parseLock,
  safePath,
  sha256,
  verifySnapshot,
  type SourceConfig,
  type TreeFile,
} from "../scripts/sources.ts";
import { parseArgs, sync, writeSnapshot } from "../scripts/upstream.ts";
import { validate } from "../scripts/validate.ts";

const commit = "a".repeat(40);
const license = "Apache License 2.0 fixture\n";
const config: SourceConfig = {
  repository: "anthropics/skills",
  sourceRoot: "skills/claude-api",
  destination: "plugins/example/references/anthropic",
  lockfile: "plugins/example/references/upstream.lock.json",
  include: ["shared/managed-agents-*.md"],
  support: ["LICENSE.txt"],
  optionalReferences: ["shared/optional.md"],
  licenseSha256: sha256(license),
};
const fixture = new Map([
  ["LICENSE.txt", license],
  [
    "shared/managed-agents-overview.md",
    "Read `shared/helpers.md` and [details](./details.md#topic).\n",
  ],
  ["shared/helpers.md", "Read `python/managed-agents/README.md`.\n"],
  ["shared/details.md", "Read `shared/optional.md` if available.\n"],
  ["python/managed-agents/README.md", "Read `shared/helpers.md` again.\n"],
  ["SKILL.md", "This broad upstream skill must not be installed.\n"],
]);

const directories: string[] = [];
let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">> | undefined;
afterEach(async () => {
  fetchSpy?.mockRestore();
  fetchSpy = undefined;
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "agent-plugins-test-"));
  directories.push(root);
  await writeFile(resolve(root, "sources.json"), JSON.stringify(config));
  return root;
}

function treeFor(files = fixture): TreeFile[] {
  return [...files].map(([path, value]) => ({
    path,
    size: Buffer.byteLength(value),
    sha: gitBlobSha1(Buffer.from(value)),
    mode: "100644",
  }));
}

async function snapshot(files = fixture) {
  return collectSnapshot(config, commit, treeFor(files), async (file) =>
    Buffer.from(files.get(file.path)!),
  );
}

function mockGitHub(refCommit = commit, files = fixture): string[] {
  const requests: string[] = [];
  const implementation = async (input: Parameters<typeof fetch>[0]): Promise<Response> => {
    const url = String(input);
    requests.push(url);
    if (url.includes("/commits/")) return Response.json({ sha: refCommit });
    if (url.includes("/git/trees/"))
      return Response.json({
        truncated: false,
        tree: treeFor(files).map((file) => ({
          ...file,
          path: `${config.sourceRoot}/${file.path}`,
          type: "blob",
        })),
      });
    const path = decodeURIComponent(url.split(`${config.sourceRoot}/`)[1] ?? "");
    return files.has(path)
      ? new Response(files.get(path)!)
      : new Response("missing", { status: 404 });
  };
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(implementation, { preconnect: () => {} }),
  );
  return requests;
}

describe("source selection", () => {
  test("includes dependency closure, preserves bytes, and excludes the broad skill", async () => {
    const result = await snapshot();
    expect(result.contents.size).toBe(5);
    expect(result.contents.has("SKILL.md")).toBe(false);
    expect(result.lock.files.find((file) => file.path === "shared/helpers.md")?.reason).toBe(
      "dependency",
    );
    for (const [path, data] of result.contents)
      expect(Buffer.from(data).toString()).toBe(fixture.get(path)!);
    expect(JSON.stringify(await snapshot())).toBe(JSON.stringify(result));
  });

  test("parses source-root paths and relative Markdown links, not GitHub URL paths", () => {
    const text =
      "Read `shared/guide.md` or [guide](../../shared/guide.md#x), https://github.com/anthropics/anthropic-sdk-python/blob/main/MIGRATION.md";
    expect([...documentReferences(text, "python/managed-agents/README.md")]).toEqual([
      "shared/guide.md",
    ]);
  });

  test("fails on a missing selected file, missing dependency, or empty pattern", async () => {
    for (const path of ["LICENSE.txt", "shared/helpers.md", "shared/managed-agents-overview.md"]) {
      const files = new Map(fixture);
      files.delete(path);
      await expect(snapshot(files)).rejects.toThrow();
    }
  });

  test("imports referenced helper scripts as inert bytes", async () => {
    const files = new Map(fixture);
    files.set("shared/managed-agents-overview.md", "Read `shared/check.py`.\n");
    files.set("shared/check.py", "raise RuntimeError('must never execute')\n");
    const result = await snapshot(files);
    expect(Buffer.from(result.contents.get("shared/check.py")!).toString()).toContain(
      "must never execute",
    );
  });

  test("rejects changed licenses, corrupt blobs, oversized files, and symlinks", async () => {
    const changed = new Map(fixture);
    changed.set("LICENSE.txt", "Different license");
    await expect(snapshot(changed)).rejects.toThrow("license changed");
    await expect(
      collectSnapshot(config, commit, treeFor(), async () => Buffer.from("corrupt")),
    ).rejects.toThrow("blob mismatch");
    for (const replacement of [{ mode: "120000" }, { size: 2_000_001 }]) {
      const tree = treeFor().map((file) =>
        file.path === "LICENSE.txt" ? { ...file, ...replacement } : file,
      );
      await expect(
        collectSnapshot(config, commit, tree, async (file) => Buffer.from(fixture.get(file.path)!)),
      ).rejects.toThrow();
    }
  });

  test("rejects unsafe paths and overlapping lock destinations", () => {
    for (const path of ["", "/absolute", "../escape", "a/../b", "a\\b", "a//b", "./a"])
      expect(() => safePath(path)).toThrow();
    expect(() => parseConfig({ ...config, destination: ".git" })).toThrow();
    expect(() => parseConfig({ ...config, lockfile: `${config.destination}/lock.json` })).toThrow();
    expect(() => documentReferences("[escape](../../../outside.md)", "shared/guide.md")).toThrow();
  });
});

describe("locking and refresh", () => {
  test("writes a verifiable snapshot and detects tampering, extra files, and selection drift", async () => {
    const root = await temporaryRoot();
    const original = await snapshot();
    await writeSnapshot(root, config, original);
    expect((await verifySnapshot(root, config)).commit).toBe(commit);
    await writeFile(resolve(root, config.destination, "extra.md"), "unexpected");
    await expect(verifySnapshot(root, config)).rejects.toThrow("inventory");
    await rm(resolve(root, config.destination, "extra.md"));
    await writeFile(resolve(root, config.destination, "LICENSE.txt"), "tampered");
    await expect(verifySnapshot(root, config)).rejects.toThrow("content changed");
    await writeSnapshot(root, config, original);
    await expect(verifySnapshot(root, { ...config, optionalReferences: [] })).rejects.toThrow(
      "sources.json changed",
    );
    expect(() => parseLock({ ...original.lock, commit: "main" })).toThrow("full commit");
    expect(() =>
      parseLock({ ...original.lock, files: [...original.lock.files, original.lock.files[0]] }),
    ).toThrow("Duplicate");
  });

  test("removes obsolete files without leaving staging artifacts", async () => {
    const root = await temporaryRoot();
    await writeSnapshot(root, config, await snapshot());
    const files = new Map(fixture);
    files.set("shared/managed-agents-overview.md", "No dependencies now.\n");
    await writeSnapshot(root, config, await snapshot(files));
    expect(await listFiles(resolve(root, config.destination))).toEqual([
      "LICENSE.txt",
      "shared/managed-agents-overview.md",
    ]);
    await verifySnapshot(root, config);
    expect((await listFiles(root)).some((path) => path.startsWith(".refresh-"))).toBe(false);
  });

  test("restores the pinned commit unless an explicit ref is supplied", async () => {
    const root = await temporaryRoot();
    await writeSnapshot(root, config, await snapshot());
    const requests = mockGitHub();
    expect(await sync(root, { check: false })).toBe(true);
    expect(requests[0]).toEndWith(`/commits/${commit}`);
    expect(requests.some((url) => url.endsWith("/commits/main"))).toBe(false);
  });

  test("check mode reports drift without writing any files", async () => {
    const root = await temporaryRoot();
    await writeSnapshot(root, config, await snapshot());
    const before = await readFile(resolve(root, config.lockfile), "utf8");
    mockGitHub("b".repeat(40));
    expect(await sync(root, { ref: "main", check: true })).toBe(false);
    expect(await readFile(resolve(root, config.lockfile), "utf8")).toBe(before);
    await verifySnapshot(root, config);
  });

  test("network errors leave the previous snapshot and lock untouched", async () => {
    const root = await temporaryRoot();
    await writeSnapshot(root, config, await snapshot());
    const before = await readFile(resolve(root, config.lockfile), "utf8");
    fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(async () => new Response("unavailable", { status: 503 }), {
        preconnect: () => {},
      }),
    );
    await expect(sync(root, { ref: "main", check: false })).rejects.toThrow("503");
    expect(await readFile(resolve(root, config.lockfile), "utf8")).toBe(before);
    await verifySnapshot(root, config);
  });

  test("rolls back the directory if installing the lock fails", async () => {
    const root = await temporaryRoot();
    await writeSnapshot(root, config, await snapshot());
    const blocked = "plugins/example/references/blocked.lock";
    await mkdir(resolve(root, blocked));
    const changed = new Map(fixture);
    changed.set("shared/managed-agents-overview.md", "New content\n");
    await expect(
      writeSnapshot(root, { ...config, lockfile: blocked }, await snapshot(changed)),
    ).rejects.toThrow();
    await verifySnapshot(root, config);
    expect((await listFiles(root)).some((path) => path.startsWith(".refresh-"))).toBe(false);
  });

  test("accepts only documented command arguments", () => {
    expect(parseArgs([])).toEqual({ check: false });
    expect(parseArgs(["--check", "--ref", "main"])).toEqual({ check: true, ref: "main" });
    for (const args of [["--ref"], ["--ref", "--check"], ["--unknown"], ["--check", "--check"]])
      expect(() => parseArgs(args)).toThrow("Usage");
  });
});

test("the shipped marketplace, focused router, and complete source pack validate offline", async () => {
  await validate(new URL("..", import.meta.url).pathname);
});

test("rejects missing paths from the router's relative-path tables", async () => {
  const root = await temporaryRoot();
  const source = new URL("..", import.meta.url).pathname;
  for (const path of [".claude-plugin", ".devin-plugin", "plugins", "sources.json"]) {
    await cp(resolve(source, path), resolve(root, path), { recursive: true });
  }
  const skill = resolve(
    root,
    "plugins/claude-managed-agents/skills/claude-managed-agents/SKILL.md",
  );
  await writeFile(
    skill,
    (await readFile(skill, "utf8")).replace(
      "shared/managed-agents-tools.md",
      "shared/missing-tools.md",
    ),
  );
  await expect(validate(root)).rejects.toThrow("missing-tools.md");
});
