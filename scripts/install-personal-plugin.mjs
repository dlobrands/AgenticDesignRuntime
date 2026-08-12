import { execFileSync } from "node:child_process";
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
  homedir(),
  ".codex",
  "skills",
  ".system",
  "plugin-creator",
  "scripts",
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
    "python3",
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
  execFileSync("python3", [cachebuster, target], { stdio: "inherit" });
  const marketplaceName = execFileSync("python3", [readMarketplace], {
    encoding: "utf8",
  }).trim();
  execFileSync(
    "codex",
    ["plugin", "add", `agentic-design-runtime@${marketplaceName}`],
    { stdio: "inherit" },
  );
  process.stdout.write(
    `${JSON.stringify({ status: "installed", target, marketplace, backup })}\n`,
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
