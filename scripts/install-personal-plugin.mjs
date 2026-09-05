import { runCommandSync as execFileSync } from "./platform.mjs";
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDirectory, "..");
const archivePattern = /^agentic-design-runtime-plugin-[0-9].*\.tgz$/;
const localArchives = (await readdir(scriptDirectory)).filter((name) =>
  archivePattern.test(name),
);
const release = localArchives.length
  ? scriptDirectory
  : path.join(root, "release");
const archives = (await readdir(release)).filter((name) =>
  archivePattern.test(name),
);
if (archives.length !== 1)
  throw new Error(
    `Expected exactly one built plugin archive, found ${archives.length}.`,
  );
const archiveName = archives[0];
const archive = path.join(release, archiveName);
if (!(await stat(archive).catch(() => undefined)))
  throw new Error("Build the plugin release before installing it.");

const pluginCreator = path.join(
  process.env.CODEX_HOME ?? path.join(homedir(), ".codex"),
  "skills",
  ".system",
  "plugin-creator",
  "scripts",
);
let python;
for (const candidate of process.platform === "win32"
  ? ["python", "python3", "py"]
  : ["python3"]) {
  try {
    const version = execFileSync(candidate, ["--version"], {
      encoding: "utf8",
    }).trim();
    if (!/^Python 3\./.test(version)) continue;
    python = candidate;
    break;
  } catch {
    /* Try the next installed Python launcher. */
  }
}
if (!python)
  throw new Error(
    "Python 3 is required for the supported Codex plugin helpers.",
  );
const createPlugin = path.join(pluginCreator, "create_basic_plugin.py");
const cachebuster = path.join(pluginCreator, "update_plugin_cachebuster.py");
const readMarketplace = path.join(pluginCreator, "read_marketplace_name.py");
for (const helper of [createPlugin, cachebuster, readMarketplace])
  if (!(await stat(helper).catch(() => undefined)))
    throw new Error(`Codex plugin helper is missing: ${helper}`);

const temporary = await mkdtemp(path.join(tmpdir(), "agentic-plugin-install-"));
const extracted = path.join(temporary, "plugin");
const target = path.join(homedir(), "plugins", "agentic-design-runtime");
const marketplace = path.join(
  homedir(),
  ".agents",
  "plugins",
  "marketplace.json",
);
let backup;
try {
  await mkdir(extracted);
  execFileSync("tar", ["-xzf", archive, "-C", extracted], {
    stdio: "inherit",
  });
  if (await stat(target).catch(() => undefined)) {
    backup = `${target}.backup-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    await rename(target, backup);
  }
  execFileSync(
    python,
    [
      createPlugin,
      "agentic-design-runtime",
      "--with-marketplace",
      "--force",
      "--category",
      "Productivity",
    ],
    { stdio: "inherit" },
  );
  await cp(extracted, target, { recursive: true, force: true });
  execFileSync(python, [cachebuster, target], { stdio: "inherit" });
  const marketplaceName = execFileSync(python, [readMarketplace], {
    encoding: "utf8",
  }).trim();
  execFileSync(
    "codex",
    ["plugin", "add", `agentic-design-runtime@${marketplaceName}`],
    { stdio: "inherit" },
  );
  const selfTest = JSON.parse(
    execFileSync(
      "node",
      [
        path.join(target, "dist", "agent-cli.js"),
        "--plugin-root",
        target,
        "--self-test-json",
      ],
      { encoding: "utf8" },
    ),
  );
  if (selfTest.status !== "ok" || !Number.isInteger(selfTest.toolCount))
    throw new Error("Installed ADR plugin self-test did not pass.");
  process.stdout.write(
    `${JSON.stringify({
      status: "installed",
      target,
      marketplace,
      backup,
      pluginVersion: selfTest.pluginVersion,
      toolCount: selfTest.toolCount,
      requiresNewTask: true,
      nextAction:
        "Start a new Codex task before testing the refreshed ADR skills or MCP tools.",
    })}\n`,
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
