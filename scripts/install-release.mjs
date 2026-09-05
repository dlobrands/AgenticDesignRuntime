import { assertInstallationTarget } from "./platform.mjs";
import { createHash } from "node:crypto";
import {
  runCommandSync as execFileSync,
  assertSupportedPlatform,
  installedCli,
  renameWithRetry,
} from "./platform.mjs";
import {
  mkdir,
  mkdtemp,
  readFile,
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
assertSupportedPlatform();
if (Number(process.versions.node.split(".")[0]) < 22)
  throw new Error("ADR requires Node.js 22 or newer.");
if ([homedir(), path.parse(target).root, process.cwd()].includes(target))
  throw new Error("Refusing a broad installation target.");

await assertInstallationTarget(target);
const checksumLines = (await readFile(path.join(release, "SHA256SUMS"), "utf8"))
  .trim()
  .split(/\r?\n/);
const verifiedFiles = new Set();
for (const line of checksumLines) {
  const match = /^([0-9a-f]{64}) {2}([^/]+)$/.exec(line);
  if (
    !match ||
    match[2].includes("\\") ||
    match[2].includes(":") ||
    match[2] === ".." ||
    verifiedFiles.has(match[2])
  )
    throw new Error(`Invalid checksum entry: ${line}`);
  verifiedFiles.add(match[2]);
  const bytes = await readFile(path.join(release, match[2]));
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== match[1]) throw new Error(`Checksum mismatch: ${match[2]}`);
}
if (!verifiedFiles.has("release-manifest.json"))
  throw new Error("Release manifest is absent from SHA256SUMS.");
const manifest = JSON.parse(
  await readFile(path.join(release, "release-manifest.json"), "utf8"),
);
if (
  !manifest.supportedTargets?.some(
    (target) =>
      target.platform === process.platform &&
      target.architecture === process.arch,
  ) &&
  !(
    process.platform === "darwin" &&
    process.arch === "arm64" &&
    manifest.platform === "macOS Apple Silicon"
  )
)
  throw new Error(
    "Release manifest does not support this operating system and architecture.",
  );
if (!/^\d+\.\d+\.\d+$/.test(manifest.renderer?.playwright ?? ""))
  throw new Error("Release manifest is missing an exact Playwright version.");
if (!/^\d+\.\d+\.\d+$/.test(manifest.version))
  throw new Error("Release manifest version is invalid.");
const runtime = `tva-agentic-design-runtime-${manifest.version}.tgz`;
const mcp = `tva-agentic-design-mcp-${manifest.version}.tgz`;
for (const name of [runtime, mcp]) {
  if (!verifiedFiles.has(name))
    throw new Error(`Required archive is absent from SHA256SUMS: ${name}`);
  const artifact = manifest.artifacts?.find((entry) => entry.name === name);
  const bytes = await readFile(path.join(release, name));
  if (
    !artifact ||
    artifact.sha256 !== createHash("sha256").update(bytes).digest("hex") ||
    artifact.sizeBytes !== bytes.length
  )
    throw new Error(`Release artifact does not match its manifest: ${name}`);
}

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
    [
      "add",
      path.join(release, runtime),
      path.join(release, mcp),
      `playwright@${manifest.renderer.playwright}`,
    ],
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
      process.execPath,
      [installedCli(staging, binary), "--version"],
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
    await renameWithRetry(target, backup);
  }
  await renameWithRetry(staging, target);
  process.stdout.write(
    `${JSON.stringify({ status: "installed", target, backup, version: manifest.version })}\n`,
  );
} catch (error) {
  if (
    backup &&
    !(await stat(target).catch(() => undefined)) &&
    (await stat(backup).catch(() => undefined))
  )
    await renameWithRetry(backup, target);
  await rm(staging, { recursive: true, force: true });
  throw error;
}
