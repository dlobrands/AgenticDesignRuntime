import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = path.resolve(process.argv[2] ?? "public-snapshot");
const manifest = JSON.parse(
  await readFile(path.join(root, "PUBLIC_SOURCE_MANIFEST.json"), "utf8"),
);
if (
  manifest.schemaVersion !== 1 ||
  manifest.repository !== "dlobrands/AgenticDesignRuntime" ||
  !/^[0-9a-f]{40}$/.test(manifest.sourceCommit) ||
  !Array.isArray(manifest.files)
)
  throw new Error("Public source manifest is invalid.");
for (const entry of manifest.files) {
  const file = path.join(root, entry.path);
  const metadata = await stat(file);
  const bytes = await readFile(file);
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (
    !metadata.isFile() ||
    bytes.length !== entry.sizeBytes ||
    digest !== entry.sha256
  )
    throw new Error(`Public snapshot digest mismatch: ${entry.path}`);
}
for (const forbidden of [
  "docs/ADR_PRODUCT_MATURITY_GOAL.md",
  ".github/workflows/promote-public.yml",
  "release/SHA256SUMS",
])
  if (await stat(path.join(root, forbidden)).catch(() => undefined))
    throw new Error(
      `Private-only file escaped into public snapshot: ${forbidden}`,
    );
process.stdout.write(
  `${JSON.stringify({ status: "verified", files: manifest.files.length, sourceCommit: manifest.sourceCommit })}\n`,
);
