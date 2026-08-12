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
const publicWorkflowPath = path.join(
  root,
  ".github",
  "workflows",
  "publish-npm.yml",
);
const workflow = await readFile(workflowPath, "utf8").catch((error) => {
  if (error.code === "ENOENT") return undefined;
  throw error;
});

const privateContracts = [
  "workflow_dispatch:",
  "source_commit:",
  "release_version:",
  "confirmation:",
  "github.actor == github.repository_owner",
  "github.ref == 'refs/heads/main'",
  "ref: ${{ inputs.source_commit }}",
  'test "${SOURCE_COMMIT}" = "${DISPATCH_SHA}"',
  'test "${CONFIRMATION}" = "PUBLISH ADR v${VERSION}"',
  'git tag --list "v${VERSION}"',
  "git ls-remote --tags https://github.com/dlobrands/AgenticDesignRuntime.git",
  "needs: [authorize, quality, macos-release]",
  "environment: public-production",
  "secrets.ADR_PUBLIC_REPO_TOKEN",
  "gh workflow run publish-npm.yml",
  '--ref "v${{ needs.authorize.outputs.version }}"',
  "--verify-tag",
];
if (workflow) {
  for (const contract of privateContracts)
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
      "Every private release job must check out the authorized source commit.",
    );
}

const publicWorkflow = await readFile(publicWorkflowPath, "utf8");
const publicContracts = [
  "workflow_dispatch:",
  "release_version:",
  "confirmation:",
  "github.repository == 'dlobrands/AgenticDesignRuntime'",
  "github.actor == github.repository_owner",
  "startsWith(github.ref, 'refs/tags/v')",
  "environment: public-production",
  "id-token: write",
  'test "${GITHUB_REF}" = "refs/tags/v${VERSION}"',
  "git+https://github.com/dlobrands/AgenticDesignRuntime.git",
  "pnpm install --frozen-lockfile",
  "pnpm pack:release",
  "npm publish ./release/tva-agentic-design-core-",
  "npm publish ./release/tva-agentic-design-client-",
  "npm publish ./release/tva-agentic-design-renderer-pixi-",
  "npm publish ./release/tva-agentic-design-runtime-",
  "npm publish ./release/tva-agentic-design-mcp-",
];
for (const contract of publicContracts)
  if (!publicWorkflow.includes(contract))
    throw new Error(`Public npm workflow is missing: ${contract}`);
if (/^\s+push:\s*$/m.test(publicWorkflow))
  throw new Error(
    "npm publication must not run automatically from a tag push.",
  );

process.stdout.write(
  workflow
    ? "Private promotion and public npm OIDC contracts are valid.\n"
    : "Private promotion is absent; public npm OIDC contract is valid.\n",
);
