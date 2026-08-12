import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflowPath = path.join(
  root,
  ".github",
  "workflows",
  "promote-public.yml",
);
const workflow = await readFile(workflowPath, "utf8").catch((error) => {
  if (error.code === "ENOENT") return undefined;
  throw error;
});

if (!workflow) {
  process.stdout.write(
    "Private promotion workflow is intentionally absent from this source snapshot.\n",
  );
  process.exit(0);
}

const requiredContracts = [
  "workflow_dispatch:",
  "source_commit:",
  "release_version:",
  "confirmation:",
  "github.actor == github.repository_owner",
  "github.ref == 'refs/heads/main'",
  "ref: ${{ inputs.source_commit }}",
  'test "${SOURCE_COMMIT}" = "${DISPATCH_SHA}"',
  'test "${CONFIRMATION}" = "PUBLISH ADR v${VERSION}"',
  "git ls-remote --tags https://github.com/dlobrands/AgenticDesignRuntime.git",
  "needs: [authorize, quality, macos-release]",
  "environment: public-production",
  "secrets.ADR_PUBLIC_REPO_TOKEN",
  'NPM_CONFIG_PROVENANCE: "true"',
  "--verify-tag",
];
for (const contract of requiredContracts)
  if (!workflow.includes(contract))
    throw new Error(`Promotion workflow is missing: ${contract}`);

if (/^\s+push:\s*$/m.test(workflow))
  throw new Error("Promotion must not run automatically from a tag push.");
if (
  (
    workflow.match(
      /ref: \$\{\{ needs\.authorize\.outputs\.source_commit \}\}/g,
    ) ?? []
  ).length !== 3
)
  throw new Error(
    "Every release job must check out the authorized source commit.",
  );

process.stdout.write("Private owner-dispatched promotion contract is valid.\n");
