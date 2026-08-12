import { randomUUID } from "node:crypto";
import { readFile, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import {
  RuntimeError,
  sha256,
  stableStringify,
} from "@tva-agentic-design/core";
import {
  appendJsonLine,
  commitStagedFile,
  ensureDirectory,
  readJson,
  safeRemoveFile,
  stageFile,
  writeFileAtomic,
  writeJsonAtomic,
} from "./fs-safe.js";

export type JournalPhase =
  | "created"
  | "temporary-written"
  | "canonical-renamed"
  | "history-appended"
  | "complete";

export type JournalTarget = {
  targetPath: string;
  temporaryPath: string;
  beforeContent: string | null;
  afterContent: string;
};

export type TransactionJournal = {
  schemaVersion: 1 | 2;
  transactionId: string;
  scope: "workspace" | "project" | "frame";
  previousRevision: number;
  revision: number;
  beforeHash: string;
  afterHash: string;
  targets: JournalTarget[];
  historyPath: string;
  historyLines: unknown[];
  historyEntries?: Array<{
    identity: string;
    hash: string;
    value: unknown;
  }>;
  phase: JournalPhase;
  timestamp: string;
};

const historyIdentity = (
  value: unknown,
  transactionId: string,
  index: number,
): string => {
  if (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string"
  )
    return `id:${value.id}`;
  return `transaction:${transactionId}:entry:${index}`;
};

const journalHistoryEntries = async (
  transactionId: string,
  historyLines: unknown[],
) =>
  Promise.all(
    historyLines.map(async (value, index) => ({
      identity: historyIdentity(value, transactionId, index),
      hash: await sha256(stableStringify(value)),
      value,
    })),
  );

const phaseOrder: Record<JournalPhase, number> = {
  created: 0,
  "temporary-written": 1,
  "canonical-renamed": 2,
  "history-appended": 3,
  complete: 4,
};

const fileContents = async (file: string): Promise<string | null> =>
  readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });

const historyContains = async (
  historyPath: string,
  transactionId: string,
): Promise<boolean> => {
  const contents = await fileContents(historyPath);
  if (!contents) return false;
  return contents
    .split("\n")
    .filter(Boolean)
    .some((line) => {
      try {
        return (
          (JSON.parse(line) as { transactionId?: string }).transactionId ===
          transactionId
        );
      } catch {
        return false;
      }
    });
};

const updateJournal = async (
  journalPath: string,
  journal: TransactionJournal,
  phase: JournalPhase,
): Promise<void> => {
  journal.phase = phase;
  await writeJsonAtomic(journalPath, journal);
};

export const persistJournaled = async (input: {
  root: string;
  transactionId: string;
  scope: TransactionJournal["scope"];
  previousRevision: number;
  revision: number;
  beforeHash: string;
  afterHash: string;
  targets: Array<{
    targetPath: string;
    after: unknown | string | Uint8Array;
    raw?: boolean;
  }>;
  historyPath: string;
  historyLines: unknown[];
  onPhase?: (phase: JournalPhase) => void | Promise<void>;
  onHistoryLine?: (
    index: number,
    position: "before" | "after",
  ) => void | Promise<void>;
}): Promise<void> => {
  const transactionDirectory = path.join(
    input.root,
    ".design-runtime",
    "transactions",
  );
  await ensureDirectory(transactionDirectory);
  const journalPath = path.join(
    transactionDirectory,
    `${input.transactionId}.json`,
  );
  const targets: JournalTarget[] = [];
  for (const target of input.targets) {
    const afterContent = target.raw
      ? typeof target.after === "string"
        ? target.after
        : new TextDecoder().decode(target.after as Uint8Array)
      : stableStringify(target.after, true);
    targets.push({
      targetPath: target.targetPath,
      temporaryPath: path.join(
        path.dirname(target.targetPath),
        `.${path.basename(target.targetPath)}.${input.transactionId}.${randomUUID()}.tmp`,
      ),
      beforeContent: await fileContents(target.targetPath),
      afterContent,
    });
  }
  const journal: TransactionJournal = {
    schemaVersion: 2,
    transactionId: input.transactionId,
    scope: input.scope,
    previousRevision: input.previousRevision,
    revision: input.revision,
    beforeHash: input.beforeHash,
    afterHash: input.afterHash,
    targets,
    historyPath: input.historyPath,
    historyLines: input.historyLines,
    historyEntries: await journalHistoryEntries(
      input.transactionId,
      input.historyLines,
    ),
    phase: "created",
    timestamp: new Date().toISOString(),
  };

  await writeJsonAtomic(journalPath, journal);
  await input.onPhase?.("created");
  let historyStarted = false;
  try {
    for (const target of targets)
      await stageFile(
        target.targetPath,
        target.afterContent,
        target.temporaryPath,
      );
    await updateJournal(journalPath, journal, "temporary-written");
    await input.onPhase?.("temporary-written");

    for (const target of targets)
      await commitStagedFile(target.temporaryPath, target.targetPath);
    await updateJournal(journalPath, journal, "canonical-renamed");
    await input.onPhase?.("canonical-renamed");

    for (const [index, line] of input.historyLines.entries()) {
      historyStarted = true;
      await input.onHistoryLine?.(index, "before");
      await appendJsonLine(input.historyPath, line);
      await input.onHistoryLine?.(index, "after");
    }
    await updateJournal(journalPath, journal, "history-appended");
    await input.onPhase?.("history-appended");
    await updateJournal(journalPath, journal, "complete");
    await input.onPhase?.("complete");
    await rm(journalPath, { force: true });
  } catch (error) {
    if (!historyStarted) {
      for (const target of targets) {
        if (target.beforeContent === null)
          await rm(target.targetPath, { force: true }).catch(() => undefined);
        else
          await writeFileAtomic(target.targetPath, target.beforeContent).catch(
            () => undefined,
          );
        await rm(target.temporaryPath, { force: true }).catch(() => undefined);
      }
      await rm(journalPath, { force: true }).catch(() => undefined);
    }
    throw error;
  }
};

const exactHistoryPresence = async (
  journal: TransactionJournal,
): Promise<boolean[]> => {
  const expected =
    journal.historyEntries ??
    (await journalHistoryEntries(journal.transactionId, journal.historyLines));
  const contents = await fileContents(journal.historyPath);
  const existing = (contents ?? "")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as unknown;
      } catch {
        return undefined;
      }
    })
    .filter((value) => value !== undefined);
  const byIdentity = new Map<string, unknown>();
  for (const [index, value] of existing.entries()) {
    const identity = historyIdentity(value, journal.transactionId, index);
    byIdentity.set(identity, value);
  }
  return Promise.all(
    expected.map(async (entry) => {
      const value = byIdentity.get(entry.identity);
      if (value === undefined) return false;
      const actualHash = await sha256(stableStringify(value));
      if (actualHash !== entry.hash)
        throw new RuntimeError(
          "HISTORY_HASH_MISMATCH",
          `History entry ${entry.identity} conflicts with the pending journal.`,
          {
            identity: entry.identity,
            expected: entry.hash,
            actual: actualHash,
          },
        );
      return true;
    }),
  );
};

export const recoverJournals = async (root: string): Promise<number> => {
  const directory = path.join(root, ".design-runtime", "transactions");
  await ensureDirectory(directory);
  const entries = await readdir(directory, { withFileTypes: true });
  let recovered = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const journalPath = path.join(directory, entry.name);
    const journal = (await readJson(journalPath)) as TransactionJournal;
    if (journal.schemaVersion !== 1 && journal.schemaVersion !== 2) continue;
    const exactPresence =
      journal.schemaVersion === 2
        ? await exactHistoryPresence(journal)
        : undefined;
    const committed = exactPresence
      ? exactPresence.some(Boolean)
      : await historyContains(journal.historyPath, journal.transactionId);
    if (
      committed ||
      phaseOrder[journal.phase] >= phaseOrder["canonical-renamed"]
    ) {
      for (const target of journal.targets) {
        const current = await fileContents(target.targetPath);
        if (current !== target.afterContent)
          await writeFileAtomic(target.targetPath, target.afterContent);
        await safeRemoveFile(target.temporaryPath);
      }
      if (exactPresence) {
        for (const [index, line] of journal.historyLines.entries())
          if (!exactPresence[index])
            await appendJsonLine(journal.historyPath, line);
      } else if (!committed) {
        for (const line of journal.historyLines)
          await appendJsonLine(journal.historyPath, line);
      }
    } else {
      for (const target of journal.targets) {
        if (target.beforeContent === null)
          await safeRemoveFile(target.targetPath);
        else await writeFileAtomic(target.targetPath, target.beforeContent);
        await safeRemoveFile(target.temporaryPath);
      }
    }
    await safeRemoveFile(journalPath);
    recovered += 1;
  }
  return recovered;
};

export const listPendingJournals = async (
  root: string,
): Promise<Array<{ path: string; ageMs: number }>> => {
  const directory = path.join(root, ".design-runtime", "transactions");
  const entries = await readdir(directory, { withFileTypes: true }).catch(
    () => [],
  );
  return Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map(async (entry) => {
        const target = path.join(directory, entry.name);
        return {
          path: target,
          ageMs: Date.now() - (await stat(target)).mtimeMs,
        };
      }),
  );
};
