import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import {
  assertSupportedPlatform,
  runCommandSync,
  installedCli,
  protectPrivatePath,
  isPrivateFile,
  readPackageVersion,
} from "./platform.mjs";
const targetIndex = process.argv.indexOf("--target");
const target =
  targetIndex >= 0 ? path.resolve(process.argv[targetIndex + 1]) : undefined;
const checks = [];
const check = async (name, action) => {
  try {
    checks.push({ name, ok: true, detail: await action() });
  } catch (error) {
    checks.push({ name, ok: false, detail: error.message });
  }
};
await check("platform", () => assertSupportedPlatform());
await check("node", () => {
  if (Number(process.versions.node.split(".")[0]) < 22)
    throw new Error("Node >=22 required.");
  return process.versions.node;
});
await check("pnpm", () => {
  const version = runCommandSync("pnpm", ["--version"], {
    encoding: "utf8",
  }).trim();
  if (version !== "10.34.5")
    throw new Error(`pnpm 10.34.5 required; found ${version}.`);
  return version;
});
await check("private-files", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "adr-permissions-"));
  try {
    await protectPrivatePath(directory);
    const file = path.join(directory, "probe");
    await writeFile(file, "permission probe", { mode: 0o600 });
    if (!(await isPrivateFile(file)))
      throw new Error("Private file protection failed.");
    return "owner access verified";
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
if (target) {
  const expectedVersion = readPackageVersion(
    target,
    "@tva-agentic-design/runtime",
  );
  for (const binary of [
    "design-runtime",
    "design-runtime-mcp",
    "agentic-design-mcp",
  ])
    await check(binary, () => {
      const version = runCommandSync(
        process.execPath,
        [installedCli(target, binary), "--version"],
        { encoding: "utf8", timeout: 15000 },
      ).trim();
      if (version !== expectedVersion)
        throw new Error(
          `${binary} returned ${version}; expected ${expectedVersion}.`,
        );
      return version;
    });
  await check("runtime-render", () => {
    const result = JSON.parse(
      runCommandSync(
        process.execPath,
        [installedCli(target, "design-runtime"), "health", "--json"],
        { encoding: "utf8", timeout: 120000 },
      ).trim(),
    );
    if (result.status !== "healthy" || result.renderVerified !== true)
      throw new Error("Runtime render health failed.");
    return result;
  });
}
const ok = checks.every((entry) => entry.ok);
process.stdout.write(
  `${JSON.stringify({ status: ok ? "ready" : "unsupported", checks })}\n`,
);
if (!ok) process.exitCode = 1;
