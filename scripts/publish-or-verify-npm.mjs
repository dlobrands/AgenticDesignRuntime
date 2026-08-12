import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? ""))
  throw new Error("Expected an exact semantic version argument.");

const packages = [
  ["@tva-agentic-design/core", "tva-agentic-design-core"],
  ["@tva-agentic-design/client", "tva-agentic-design-client"],
  ["@tva-agentic-design/renderer-pixi", "tva-agentic-design-renderer-pixi"],
  ["@tva-agentic-design/runtime", "tva-agentic-design-runtime"],
  ["@tva-agentic-design/mcp", "tva-agentic-design-mcp"],
];

const run = (args, options = {}) =>
  spawnSync("npm", args, {
    cwd: root,
    encoding: "utf8",
    ...options,
  });

for (const [packageName, archivePrefix] of packages) {
  const archive = path.join(root, "release", `${archivePrefix}-${version}.tgz`);
  const bytes = await readFile(archive);
  const localIntegrity = `sha512-${createHash("sha512")
    .update(bytes)
    .digest("base64")}`;
  const spec = `${packageName}@${version}`;
  const lookup = run(["view", spec, "dist.integrity", "--json"]);

  if (lookup.status === 0) {
    const remoteIntegrity = JSON.parse(lookup.stdout.trim());
    if (remoteIntegrity !== localIntegrity)
      throw new Error(
        `${spec} already exists with different immutable archive bytes.`,
      );
    process.stdout.write(`${spec}: verified existing immutable archive\n`);
    continue;
  }

  if (!/\bE404\b/.test(`${lookup.stdout}\n${lookup.stderr}`))
    throw new Error(
      `${spec} registry lookup failed without an E404:\n${lookup.stderr.trim()}`,
    );

  const publish = run(["publish", archive, "--access", "public"], {
    stdio: "inherit",
  });
  if (publish.status !== 0)
    throw new Error(`${spec} publication failed with exit ${publish.status}.`);
  process.stdout.write(`${spec}: published through npm OIDC\n`);
}
