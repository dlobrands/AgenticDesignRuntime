import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cp, lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.resolve(
  process.argv[2] ?? path.join(root, "public-snapshot"),
);
const allowDirty = process.argv.includes("--allow-dirty");
if (output === root || root.startsWith(`${output}${path.sep}`))
  throw new Error("Public snapshot output must not contain the repository.");
const worktreeStatus = execFileSync(
  "git",
  ["status", "--porcelain", "--untracked-files=all"],
  { cwd: root, encoding: "utf8" },
).trim();
if (worktreeStatus && !allowDirty)
  throw new Error("Public snapshots require a clean source worktree.");

const configuration = JSON.parse(
  await readFile(path.join(root, "public-release-files.json"), "utf8"),
);
const excluded = configuration.excluded;
const matches = (file, pattern) =>
  pattern.endsWith("/**")
    ? file === pattern.slice(0, -3) || file.startsWith(pattern.slice(0, -2))
    : file === pattern;
const tracked = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  {
    cwd: root,
    encoding: "utf8",
  },
)
  .split("\0")
  .filter(Boolean)
  .sort();
const files = tracked.filter(
  (file) => !excluded.some((pattern) => matches(file, pattern)),
);

for (const required of configuration.required)
  if (!files.includes(required))
    throw new Error(`Required public file is not tracked: ${required}`);

const forbiddenPath =
  /(^|\/)(\.env(?:\.|$)|\.design-runtime|design-runtime|projects|test-results|playwright-report)(\/|$)/;
const secretPatterns = [
  /github_pat_[A-Za-z0-9_]{20,}/,
  /gh[oprsu]_[A-Za-z0-9]{20,}/,
  /npm_[A-Za-z0-9]{20,}/,
  /\/Users\/[A-Za-z0-9._-]+\//,
  /\/Volumes\//,
];
const entries = [];
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const file of files) {
  if (forbiddenPath.test(file))
    throw new Error(`Forbidden public path is tracked: ${file}`);
  const source = path.join(root, file);
  const metadata = await lstat(source);
  if (metadata.isSymbolicLink())
    throw new Error(`Public snapshots do not permit symlinks: ${file}`);
  if (!metadata.isFile()) throw new Error(`Unexpected tracked entry: ${file}`);
  if (metadata.size > 10 * 1024 * 1024)
    throw new Error(`Public source file exceeds 10 MiB: ${file}`);
  const bytes = await readFile(source);
  const text = bytes.includes(0) ? undefined : bytes.toString("utf8");
  if (text)
    for (const pattern of secretPatterns)
      if (pattern.test(text))
        throw new Error(`Public source scan rejected ${file}: ${pattern}`);
  const target = path.join(output, file);
  await mkdir(path.dirname(target), { recursive: true });
  await cp(source, target, { preserveTimestamps: true });
  entries.push({
    path: file,
    sizeBytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}

const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).trim();
const sourceCommittedAt = execFileSync(
  "git",
  ["show", "-s", "--format=%cI", sourceCommit],
  { cwd: root, encoding: "utf8" },
).trim();
await writeFile(
  path.join(output, "PUBLIC_SOURCE_MANIFEST.json"),
  `${JSON.stringify(
    {
      schemaVersion: 1,
      repository: configuration.publicRepository,
      sourceRepository: configuration.privateRepository,
      sourceCommit,
      sourceCommittedAt,
      files: entries,
    },
    null,
    2,
  )}\n`,
  { mode: 0o644 },
);
process.stdout.write(`${output}\n`);
