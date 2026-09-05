import type { ExecFileSyncOptions } from "node:child_process";
export const supportedTargets: {
  platform: string;
  architecture: string;
  minimumRelease: string;
}[];
export function assertSupportedPlatform(
  platform?: string,
  architecture?: string,
  osRelease?: string,
): { platform: string; architecture: string; minimumRelease: string };
export function nodeInvocation(
  entrypoint: string,
  args?: string[],
): { command: string; args: string[] };
export function commandInvocation(
  command: string,
  args?: string[],
  cwd?: string,
): { command: string; args: string[] };
export function runCommandSync(
  command: string,
  args?: string[],
  options?: ExecFileSyncOptions,
): string | Buffer;
export function installedCli(target: string, binary: string): string;
export function windowsScript(script: string, input: unknown): string;
export function protectPrivatePath(target: string): Promise<void>;
export function isPrivateFile(target: string): Promise<boolean>;
export function pathIsInside(
  root: string,
  candidate: string,
  platform?: string,
): boolean;
export function assertPortableRelativePath(relative: string): void;
export function assertWindowsPath(value: string): void;
export function assertLocalWorkspace(target: string): Promise<void>;
export function renameWithRetry(
  source: string,
  destination: string,
): Promise<void>;
export function readPackageVersion(target: string, packageName: string): string;

export function assertInstallationTarget(
  target: string,
  requireExisting?: boolean,
): Promise<void>;
