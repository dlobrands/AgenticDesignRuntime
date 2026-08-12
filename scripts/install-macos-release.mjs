import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";

const argument = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const release = path.resolve(argument("--release") ?? process.cwd());
const target = path.resolve(
  argument("--target") ??
    path.join(homedir(), ".agentic-design-runtime", "current"),
);
const skipBrowser = process.argv.includes("--skip-browser");
if (process.platform !== "darwin" || process.arch !== "arm64")
  throw new Error(
    "ADR production releases require macOS on Apple Silicon (arm64).",
  );
if (Number(process.versions.node.split(".")[0]) < 22)
  throw new Error("ADR requires Node.js 22 or newer.");
if ([homedir(), path.parse(target).root, process.cwd()].includes(target))
  throw new Error("Refusing a broad installation target.");

const checksumLines = (await readFile(path.join(release, "SHA256SUMS"), "utf8"))
  .trim()
  .split("\n");
for (const line of checksumLines) {
  const match = /^([0-9a-f]{64}) {2}([^/]+)$/.exec(line);
  if (!match) throw new Error(`Invalid checksum entry: ${line}`);
  const bytes = await readFile(path.join(release, match[2]));
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== match[1]) throw new Error(`Checksum mismatch: ${match[2]}`);
}
const manifest = JSON.parse(
  await readFile(path.join(release, "release-manifest.json"), "utf8"),
);
if (manifest.platform !== "macOS Apple Silicon")
  throw new Error(
    "Release manifest is not the supported macOS arm64 platform.",
  );
const files = await readdir(release);
const runtime = files.find((name) =>
  /^agentic-design-runtime-[0-9].*\.tgz$/.test(name),
);
const mcp = files.find((name) =>
  /^agentic-design-mcp-[0-9].*\.tgz$/.test(name),
);
if (!runtime || !mcp)
  throw new Error("Release runtime or MCP package is missing.");

await mkdir(path.dirname(target), { recursive: true });
const staging = await mkdtemp(path.join(path.dirname(target), ".adr-install-"));
let backup;
try {
  await writeFile(
    path.join(staging, "package.json"),
    `${JSON.stringify({ private: true, packageManager: "pnpm@10.34.5" })}\n`,
  );
  execFileSync(
    "pnpm",
    ["add", path.join(release, runtime), path.join(release, mcp)],
    {
      cwd: staging,
      stdio: "inherit",
    },
  );
  if (!skipBrowser)
    execFileSync("pnpm", ["exec", "playwright", "install", "chromium"], {
      cwd: staging,
      stdio: "inherit",
    });
  for (const binary of [
    "design-runtime",
    "design-runtime-mcp",
    "agentic-design-mcp",
  ]) {
    const output = execFileSync(
      path.join(staging, "node_modules", ".bin", binary),
      ["--version"],
      {
        cwd: staging,
        encoding: "utf8",
      },
    ).trim();
    if (output !== manifest.version)
      throw new Error(
        `${binary} reported ${output}; expected ${manifest.version}.`,
      );
  }
  if (await stat(target).catch(() => undefined)) {
    backup = `${target}.backup-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    await rename(target, backup);
  }
  await rename(staging, target);
  process.stdout.write(
    `${JSON.stringify({ status: "installed", target, backup, version: manifest.version })}\n`,
  );
} catch (error) {
  if (
    backup &&
    !(await stat(target).catch(() => undefined)) &&
    (await stat(backup).catch(() => undefined))
  )
    await rename(backup, target);
  await rm(staging, { recursive: true, force: true });
  throw error;
}
