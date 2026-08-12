import { execFileSync } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const targetIndex = process.argv.indexOf("--target");
const target =
  targetIndex >= 0 ? path.resolve(process.argv[targetIndex + 1]) : undefined;
const checks = [];
const record = (name, ok, detail) => checks.push({ name, ok, detail });
record("platform", process.platform === "darwin", process.platform);
record("architecture", process.arch === "arm64", process.arch);
const nodeMajor = Number(process.versions.node.split(".")[0]);
record("node", nodeMajor >= 22, process.versions.node);
let pnpmVersion;
try {
  pnpmVersion = execFileSync("pnpm", ["--version"], {
    encoding: "utf8",
  }).trim();
} catch {
  pnpmVersion = "unavailable";
}
record("pnpm", pnpmVersion === "10.34.5", pnpmVersion);
if (target) {
  for (const binary of [
    "design-runtime",
    "design-runtime-mcp",
    "agentic-design-mcp",
  ]) {
    const file = path.join(target, "node_modules", ".bin", binary);
    const exists = Boolean(await stat(file).catch(() => undefined));
    let version = "missing";
    if (exists)
      version = execFileSync(file, ["--version"], { encoding: "utf8" }).trim();
    record(binary, exists && /^\d+\.\d+\.\d+/.test(version), version);
  }
}
const ok = checks.every((check) => check.ok);
process.stdout.write(
  `${JSON.stringify({ status: ok ? "ready" : "unsupported", checks })}\n`,
);
if (!ok) process.exitCode = 1;
