import { homedir } from "node:os";
import path from "node:path";
import { readJson, writeJsonAtomic } from "./fs-safe.js";

export type RuntimePreferences = {
  schemaVersion: 1;
  lastOpenedWorkspace?: string;
  recentWorkspaces: string[];
};

export const preferencesPath = (): string =>
  process.env.ADR_PREFERENCES_PATH ??
  path.join(homedir(), ".design-runtime", "preferences.json");

export const readPreferences = async (): Promise<RuntimePreferences> => {
  const value = await readJson(preferencesPath()).catch(() => undefined);
  if (!value || typeof value !== "object")
    return { schemaVersion: 1, recentWorkspaces: [] };
  const input = value as Partial<RuntimePreferences>;
  return {
    schemaVersion: 1,
    ...(typeof input.lastOpenedWorkspace === "string"
      ? { lastOpenedWorkspace: input.lastOpenedWorkspace }
      : {}),
    recentWorkspaces: Array.isArray(input.recentWorkspaces)
      ? input.recentWorkspaces.filter(
          (entry): entry is string => typeof entry === "string",
        )
      : [],
  };
};

export const rememberWorkspace = async (workspace: string): Promise<void> => {
  const current = await readPreferences();
  const recentWorkspaces = [
    workspace,
    ...current.recentWorkspaces.filter((entry) => entry !== workspace),
  ].slice(0, 12);
  await writeJsonAtomic(
    preferencesPath(),
    {
      schemaVersion: 1,
      lastOpenedWorkspace: workspace,
      recentWorkspaces,
    } satisfies RuntimePreferences,
    0o600,
  );
};
