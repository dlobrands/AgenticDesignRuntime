import { open, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { appendJsonLine, ensureDirectory, writeJsonAtomic } from "./fs-safe.js";
import type { RuntimeMetricState } from "./types.js";

type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";
const levels: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  fatal: 50,
};

const readTail = async (file: string, maxBytes = 256 * 1024) => {
  const handle = await open(file, "r");
  try {
    const size = (await handle.stat()).size;
    const start = Math.max(0, size - maxBytes);
    const buffer = Buffer.alloc(size - start);
    await handle.read(buffer, 0, buffer.length, start);
    const lines = buffer.toString("utf8").split("\n");
    if (start > 0) lines.shift();
    return lines.filter(Boolean);
  } finally {
    await handle.close();
  }
};

export const recentLogLinesFromDirectory = async (
  directory: string,
  limit = 500,
): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true }).catch(
    () => [],
  );
  const files = await Promise.all(
    entries
      .filter(
        (entry) =>
          entry.isFile() &&
          (entry.name.endsWith(".jsonl") || entry.name.includes(".jsonl.")),
      )
      .map(async (entry) => {
        const file = path.join(directory, entry.name);
        return stat(file)
          .then((info) => ({ file, modified: info.mtimeMs }))
          .catch(() => undefined);
      }),
  );
  const lines: string[] = [];
  for (const entry of files
    .filter((candidate): candidate is NonNullable<typeof candidate> =>
      Boolean(candidate),
    )
    .sort((left, right) => right.modified - left.modified)) {
    lines.unshift(...(await readTail(entry.file).catch(() => [])));
    if (lines.length >= limit) break;
  }
  return lines.slice(-limit);
};

export class RuntimeLogger {
  readonly #directory: string;
  readonly #level: LogLevel;
  readonly #maxBytes: number;
  readonly #maxFiles: number;
  readonly #retentionMs: number;

  constructor(input: {
    directory: string;
    level: LogLevel;
    maxFileSizeMb: number;
    maxFiles: number;
    retentionDays: number;
  }) {
    this.#directory = input.directory;
    this.#level = input.level;
    this.#maxBytes = input.maxFileSizeMb * 1024 * 1024;
    this.#maxFiles = input.maxFiles;
    this.#retentionMs = input.retentionDays * 86_400_000;
  }

  async log(
    level: LogLevel,
    event: string,
    fields: Record<string, unknown> = {},
  ): Promise<void> {
    if (levels[level] < levels[this.#level]) return;
    const date = new Date().toISOString().slice(0, 10);
    const file = path.join(
      this.#directory,
      `${level === "error" || level === "fatal" ? "errors" : "runtime"}-${date}.jsonl`,
    );
    await this.#rotateIfNeeded(file);
    await appendJsonLine(file, {
      timestamp: new Date().toISOString(),
      level,
      event,
      ...this.#redact(fields),
    });
  }

  debug(event: string, fields?: Record<string, unknown>) {
    return this.log("debug", event, fields);
  }
  info(event: string, fields?: Record<string, unknown>) {
    return this.log("info", event, fields);
  }
  warn(event: string, fields?: Record<string, unknown>) {
    return this.log("warn", event, fields);
  }
  error(event: string, fields?: Record<string, unknown>) {
    return this.log("error", event, fields);
  }

  #redact(fields: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (/token|cookie|authorization|scene|text|content/i.test(key))
        result[key] = "[REDACTED]";
      else result[key] = value;
    }
    return result;
  }

  async #rotateIfNeeded(file: string): Promise<void> {
    await ensureDirectory(this.#directory);
    const size = await stat(file)
      .then((value) => value.size)
      .catch(() => 0);
    if (size >= this.#maxBytes) await rename(file, `${file}.${Date.now()}`);
    const entries = await readdir(this.#directory, { withFileTypes: true });
    const files = await Promise.all(
      entries
        .filter(
          (entry) =>
            entry.isFile() &&
            (entry.name.endsWith(".jsonl") || entry.name.includes(".jsonl.")),
        )
        .map(async (entry) => ({
          path: path.join(this.#directory, entry.name),
          modified: (await stat(path.join(this.#directory, entry.name)))
            .mtimeMs,
        })),
    );
    const ordered = files.sort((left, right) => right.modified - left.modified);
    for (const [index, entry] of ordered.entries()) {
      if (
        index >= this.#maxFiles ||
        Date.now() - entry.modified > this.#retentionMs
      )
        await rm(entry.path, { force: true });
    }
  }

  async recentLines(limit = 500): Promise<string[]> {
    return recentLogLinesFromDirectory(this.#directory, limit);
  }
}

export class RuntimeMetrics {
  readonly #currentPath: string;
  readonly #historyPath: string;
  state: RuntimeMetricState;

  constructor(directory: string, startedAt: string) {
    this.#currentPath = path.join(directory, "current-session.json");
    this.#historyPath = path.join(directory, "benchmark-history.jsonl");
    this.state = {
      startedAt,
      previewCount: 0,
      commitCount: 0,
      rejectionCount: 0,
      validationFailures: 0,
      revisionConflicts: 0,
      saveFailures: 0,
      recoveryJournalActivations: 0,
    };
  }

  async update(values: Partial<RuntimeMetricState>): Promise<void> {
    Object.assign(this.state, values);
    await writeJsonAtomic(this.#currentPath, this.state);
  }

  async increment(
    key: keyof Pick<
      RuntimeMetricState,
      | "previewCount"
      | "commitCount"
      | "rejectionCount"
      | "validationFailures"
      | "revisionConflicts"
      | "saveFailures"
      | "recoveryJournalActivations"
    >,
  ): Promise<void> {
    this.state[key] += 1;
    await this.update({});
  }

  async recordBenchmark(values: Record<string, unknown>): Promise<void> {
    await appendJsonLine(this.#historyPath, {
      timestamp: new Date().toISOString(),
      ...values,
    });
  }
}
