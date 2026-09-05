import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { cpus, release } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  assertSupportedPlatform,
  commandInvocation,
  runCommandSync,
  windowsScript,
} from "./platform.mjs";

if (process.platform !== "win32")
  throw new Error("Run this acceptance handoff on native Windows 11 x64.");
assertSupportedPlatform();
windowsScript(
  "$os = Get-CimInstance Win32_OperatingSystem; if ($os.ProductType -ne 1) { throw 'Windows 11 workstation required for native acceptance; Server CI is complementary.' }",
  {},
);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const startedAt = new Date().toISOString();
const output = path.join(
  root,
  "test-results",
  `windows-acceptance-${startedAt.replace(/[:.]/g, "-")}`,
);
await mkdir(output, { recursive: true });
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const files = [
  ...new Set(
    runCommandSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], {
      cwd: root,
      encoding: "utf8",
    })
      .split("\0")
      .filter(
        (name) =>
          name &&
          !name.startsWith("release/") &&
          !name.startsWith("design-runtime/"),
      ),
  ),
].sort();
const sourceHash = createHash("sha256");
for (const file of files) {
  sourceHash.update(file);
  sourceHash.update("\0");
  sourceHash.update(digest(await readFile(path.join(root, file))));
}
const report = {
  status: "running",
  startedAt,
  sourceCommit: runCommandSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim(),
  sourceSha256: sourceHash.digest("hex"),
  system: {
    platform: process.platform,
    architecture: process.arch,
    release: release(),
    cpu: cpus()[0]?.model,
    node: process.versions.node,
    pnpm: runCommandSync("pnpm", ["--version"], { encoding: "utf8" }).trim(),
  },
  checks: [],
  manualAcceptance: [
    "Studio opens visibly; Windows clipboard, file pickers, drag/drop, shortcuts and export downloads work.",
    "A stopped real fixture workspace round-trips between macOS and Windows with unchanged canonical content/history hashes before editing.",
    "With separate authorization, install the plugin; verify installed-cache hashes and expected four skills/tools in a new Windows Codex task.",
  ].map((check) => ({ check, status: "pending" })),
};
const save = () =>
  writeFile(
    path.join(output, "acceptance.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
const run = async (name, command, args) => {
  const invocation = commandInvocation(command, args, root);
  const started = Date.now();
  let log = "";
  const code = await new Promise((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd: root,
      env: process.env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    for (const stream of [child.stdout, child.stderr])
      stream.on("data", (chunk) => {
        log += chunk.toString();
        process.stdout.write(chunk);
      });
    child.once("error", reject);
    child.once("exit", resolve);
  });
  await mkdir(output, { recursive: true }); // Playwright clears its output directory at startup.
  await writeFile(path.join(output, `${name}.log`), log);
  report.checks.push({
    name,
    exitCode: code,
    durationMs: Date.now() - started,
  });
  await save();
  if (code !== 0) throw new Error(`${name} failed; inspect ${output}.`);
};
try {
  // Build and install only disposable local artifacts; no publishing or plugin installation.
  await run("dependencies", "pnpm", ["install", "--frozen-lockfile"]);
  await run("chromium", "pnpm", ["exec", "playwright", "install", "chromium"]);
  await run("verify", "pnpm", ["verify"]);
  await run("e2e", "pnpm", [
    "exec",
    "playwright",
    "test",
    "--output",
    path.join(output, "browser-results"),
  ]);
  await run("pack", "pnpm", ["pack:release"]);
  await run("packed", "pnpm", ["verify:packed"]);
  await run("checksums", process.execPath, [
    "scripts/verify-checksums.mjs",
    "release",
  ]);
  report.releaseManifestSha256 = digest(
    await readFile(path.join(root, "release", "release-manifest.json")),
  );
  report.checksumsSha256 = digest(
    await readFile(path.join(root, "release", "SHA256SUMS")),
  );
  await writeFile(
    path.join(output, "SHA256SUMS"),
    await readFile(path.join(root, "release", "SHA256SUMS")),
  );
  report.status = "automated-checks-passed-manual-acceptance-pending";
} catch (error) {
  report.status = "failed";
  report.error = error.message;
  process.exitCode = 1;
}
report.finishedAt = new Date().toISOString();
await save();
process.stdout.write(
  `${JSON.stringify({ status: report.status, report: path.join(output, "acceptance.json") })}\n`,
);
