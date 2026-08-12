import { mkdir, rename, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";

const index = process.argv.indexOf("--target");
const target = path.resolve(
  index >= 0
    ? process.argv[index + 1]
    : path.join(homedir(), ".agentic-design-runtime", "current"),
);
if ([homedir(), path.parse(target).root, process.cwd()].includes(target))
  throw new Error("Refusing a broad uninstall target.");
if (!(await stat(target).catch(() => undefined)))
  throw new Error(`ADR installation does not exist: ${target}`);
const recoveryIndex = process.argv.indexOf("--recovery-root");
const recoveryRoot = path.resolve(
  recoveryIndex >= 0
    ? process.argv[recoveryIndex + 1]
    : path.join(homedir(), ".agentic-design-runtime", "removed"),
);
await mkdir(recoveryRoot, { recursive: true });
const recovery = path.join(
  recoveryRoot,
  `install-${new Date().toISOString().replace(/[:.]/g, "-")}`,
);
await rename(target, recovery);
process.stdout.write(
  `${JSON.stringify({ status: "removed", target, recovery, workspacesChanged: false })}\n`,
);
