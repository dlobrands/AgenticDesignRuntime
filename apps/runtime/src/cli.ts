#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { chromium, type BrowserContext } from "playwright";
import { RuntimeError } from "@agentic-design/core";
import { RuntimeEventBus } from "./events.js";
import { recoverJournals } from "./journal.js";
import { RuntimeLogger, RuntimeMetrics } from "./logger.js";
import { startRuntimeServer } from "./server.js";
import { TransactionEngine } from "./transaction-engine.js";
import { WorkspaceWatcher } from "./watcher.js";
import { closeWorkspace, openWorkspace } from "./workspace.js";
import {
  exportDiagnostics,
  resolveDiagnosticsWorkspace,
} from "./diagnostics.js";
import { rememberWorkspace } from "./preferences.js";
import {
  openRuntimeStudio,
  runtimeStatus,
  startRuntimeDetached,
  stopRuntime,
} from "./lifecycle.js";
import { PRODUCT_VERSION } from "./version.js";
import { UpdateManager } from "./update-manager.js";

type CliOptions = {
  workspacePath: string;
  noOpen: boolean;
  port?: number;
  logLevel?: "debug" | "info" | "warn" | "error" | "fatal";
};

const usage = `Usage:
  design-runtime dev <workspace-path> [--no-open] [--port <number>] [--log-level debug|info|warn|error|fatal]
  design-runtime start <workspace-path> [--no-open] [--port <number|auto>]
  design-runtime status <workspace-path>
  design-runtime studio <workspace-path>
  design-runtime stop <workspace-path>
  design-runtime update check
  design-runtime update fetch
  design-runtime update apply
  design-runtime update rollback
  design-runtime diagnostics export [workspace-path]`;

const truthyEnvironment = (value: string | undefined): boolean =>
  value === "1" || value?.toLowerCase() === "true";

const parseArguments = (arguments_: string[]): CliOptions => {
  const positionalWorkspace =
    arguments_[1] && !arguments_[1].startsWith("-") ? arguments_[1] : undefined;
  const workspacePath =
    positionalWorkspace ?? process.env.DESIGN_RUNTIME_WORKSPACE;
  if (arguments_[0] !== "dev" || !workspacePath) throw new Error(usage);
  const environmentPort = process.env.DESIGN_RUNTIME_PORT
    ? Number(process.env.DESIGN_RUNTIME_PORT)
    : undefined;
  if (
    environmentPort !== undefined &&
    (!Number.isInteger(environmentPort) ||
      environmentPort < 1 ||
      environmentPort > 65_535)
  )
    throw new Error("DESIGN_RUNTIME_PORT requires an integer from 1 to 65535.");
  const environmentLogLevel = process.env.DESIGN_RUNTIME_LOG_LEVEL;
  if (
    environmentLogLevel &&
    !["debug", "info", "warn", "error", "fatal"].includes(environmentLogLevel)
  )
    throw new Error(
      "DESIGN_RUNTIME_LOG_LEVEL requires debug, info, warn, error, or fatal.",
    );
  const options: CliOptions = {
    workspacePath,
    noOpen: truthyEnvironment(process.env.DESIGN_RUNTIME_NO_OPEN),
    ...(environmentPort !== undefined ? { port: environmentPort } : {}),
    ...(environmentLogLevel
      ? {
          logLevel: environmentLogLevel as CliOptions["logLevel"],
        }
      : {}),
  };
  for (
    let index = positionalWorkspace ? 2 : 1;
    index < arguments_.length;
    index += 1
  ) {
    const argument = arguments_[index];
    if (argument === "--no-open") options.noOpen = true;
    else if (argument === "--port") {
      const port = Number(arguments_[index + 1]);
      if (!Number.isInteger(port) || port < 1 || port > 65_535)
        throw new Error("--port requires an integer from 1 to 65535.");
      options.port = port;
      index += 1;
    } else if (argument === "--log-level") {
      const level = arguments_[index + 1];
      if (
        !level ||
        !["debug", "info", "warn", "error", "fatal"].includes(level)
      )
        throw new Error(
          "--log-level requires debug, info, warn, error, or fatal.",
        );
      options.logLevel = level as CliOptions["logLevel"];
      index += 1;
    } else throw new Error(`Unknown argument: ${argument}\n${usage}`);
  }
  return options;
};

const existingDirectory = async (candidates: string[]): Promise<string> => {
  for (const candidate of candidates) {
    if (
      await stat(candidate)
        .then((entry) => entry.isDirectory())
        .catch(() => false)
    )
      return candidate;
  }
  return candidates[0]!;
};

export const runCli = async (
  arguments_ = process.argv.slice(2),
): Promise<void> => {
  if (arguments_.includes("--version")) {
    process.stdout.write(`${PRODUCT_VERSION}\n`);
    return;
  }
  if (arguments_.includes("--help") || arguments_.includes("-h")) {
    process.stdout.write(`${usage}\n`);
    return;
  }
  if (arguments_[0] === "diagnostics" && arguments_[1] === "export") {
    const workspace = await resolveDiagnosticsWorkspace(arguments_[2]);
    const result = await exportDiagnostics(workspace);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  if (arguments_[0] === "update") {
    const action = arguments_[1];
    if (!action || !["check", "fetch", "apply", "rollback"].includes(action))
      throw new Error(usage);
    if (arguments_.length !== 2)
      throw new Error(
        "Update commands do not accept URLs or shell arguments. Configure the trusted official origin separately.",
      );
    const manager = new UpdateManager();
    const result =
      action === "check"
        ? await manager.check()
        : action === "fetch"
          ? await manager.fetch()
          : action === "apply"
            ? await manager.apply()
            : await manager.rollback();
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  if (["start", "status", "studio", "stop"].includes(arguments_[0] ?? "")) {
    const command = arguments_[0]!;
    const workspacePath = arguments_[1];
    if (!workspacePath || workspacePath.startsWith("-")) throw new Error(usage);
    if (command === "status") {
      process.stdout.write(
        `${JSON.stringify(await runtimeStatus(workspacePath))}\n`,
      );
      return;
    }
    if (command === "studio") {
      process.stdout.write(
        `${JSON.stringify(await openRuntimeStudio(workspacePath))}\n`,
      );
      return;
    }
    if (command === "stop") {
      process.stdout.write(
        `${JSON.stringify(await stopRuntime(workspacePath))}\n`,
      );
      return;
    }
    let noOpen = false;
    let port: number | undefined;
    for (let index = 2; index < arguments_.length; index += 1) {
      const argument = arguments_[index];
      if (argument === "--no-open") noOpen = true;
      else if (argument === "--port") {
        const value = arguments_[index + 1];
        if (value !== "auto") {
          const parsed = Number(value);
          if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535)
            throw new Error(
              "--port requires auto or an integer from 1 to 65535.",
            );
          port = parsed;
        }
        index += 1;
      } else throw new Error(`Unknown argument: ${argument}\n${usage}`);
    }
    const cliPath = realpathSync(
      process.argv[1] ?? fileURLToPath(import.meta.url),
    );
    process.stdout.write(
      `${JSON.stringify(
        await startRuntimeDetached({
          workspacePath,
          cliPath,
          openStudio: !noOpen,
          ...(port ? { port } : {}),
        }),
      )}\n`,
    );
    return;
  }
  const options = parseArguments(arguments_);
  let recovered = 0;
  const workspace = await openWorkspace(options.workspacePath, {
    ...(options.port ? { port: options.port } : {}),
    ...(options.logLevel ? { logLevel: options.logLevel } : {}),
    recover: async (root) => {
      recovered = await recoverJournals(root);
    },
    ...(process.env.ADR_DESCRIPTOR_DIRECTORY
      ? { descriptorDirectory: process.env.ADR_DESCRIPTOR_DIRECTORY }
      : {}),
  });
  await rememberWorkspace(workspace.root).catch(() => undefined);
  const events = new RuntimeEventBus(workspace);
  const logger = new RuntimeLogger({
    directory: path.join(workspace.root, ".design-runtime", "logs"),
    ...workspace.config.logging,
  });
  const metrics = new RuntimeMetrics(
    path.join(workspace.root, ".design-runtime", "metrics"),
    workspace.startedAt,
  );
  if (recovered > 0) {
    await metrics.update({ recoveryJournalActivations: recovered });
    events.emit("save.recovered", { journals: recovered });
  }
  const engine = new TransactionEngine({ workspace, events, logger, metrics });
  const currentFile = fileURLToPath(import.meta.url);
  const studioDirectory = await existingDirectory([
    path.resolve(path.dirname(currentFile), "../studio"),
    path.resolve(path.dirname(currentFile), "../../studio/dist"),
    path.resolve(process.cwd(), "apps/studio/dist"),
  ]);
  let browserContext: BrowserContext | undefined;
  const openStudioUrl = async (bootstrapUrl: string): Promise<void> => {
    const profile = path.join(
      workspace.root,
      ".design-runtime",
      "cache",
      "chromium-profile",
    );
    browserContext ??= await chromium.launchPersistentContext(profile, {
      headless: false,
      viewport: null,
    });
    const page = browserContext.pages()[0] ?? (await browserContext.newPage());
    await page.goto(bootstrapUrl);
    await page.bringToFront();
  };
  const lifecycle: {
    stopRequested: boolean;
    requestStop?: (signal: string) => Promise<void>;
  } = { stopRequested: false };
  const server = await startRuntimeServer({
    workspace,
    engine,
    studioDirectory,
    openStudio: openStudioUrl,
    requestShutdown: () => {
      if (lifecycle.requestStop)
        void lifecycle.requestStop("api").finally(() => process.exit(0));
      else lifecycle.stopRequested = true;
    },
  }).catch(async (error) => {
    await closeWorkspace(workspace);
    throw error;
  });
  const watcher = new WorkspaceWatcher(workspace, engine);
  await watcher.start();

  if (!options.noOpen) {
    try {
      await server.openStudio();
    } catch (error) {
      await watcher.close();
      await server.close();
      await closeWorkspace(workspace);
      throw error;
    }
  }

  await logger.info("runtime.ready", {
    runtimeId: workspace.runtimeId,
    workspacePath: workspace.root,
    baseUrl: server.baseUrl,
    recoveredJournals: recovered,
  });
  process.stdout.write(
    `${JSON.stringify({ status: "ready", runtimeId: workspace.runtimeId, workspaceId: workspace.config.workspaceId, baseUrl: server.baseUrl, workspacePath: workspace.root })}\n`,
  );

  let stopping = false;
  const stop = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    await logger.info("runtime.stopping", { signal });
    await watcher.close();
    await browserContext?.close().catch(() => undefined);
    await server.close();
    await closeWorkspace(workspace);
  };
  lifecycle.requestStop = stop;
  process.once("SIGINT", () => {
    void stop("SIGINT").finally(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    void stop("SIGTERM").finally(() => process.exit(0));
  });
  if (lifecycle.stopRequested) void stop("api").finally(() => process.exit(0));
};

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  runCli().catch((error) => {
    process.stderr.write(
      `${JSON.stringify(
        error instanceof RuntimeError
          ? {
              error: {
                code: error.code,
                message: error.message,
                ...(error.details ? { details: error.details } : {}),
              },
            }
          : {
              error: {
                code: "INVALID_OPERATION",
                message: error instanceof Error ? error.message : String(error),
              },
            },
      )}\n`,
    );
    process.exitCode = 1;
  });
}
