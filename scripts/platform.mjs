import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { chmod, lstat, readdir, realpath, rename } from "node:fs/promises";
import { createRequire } from "node:module";
import { release } from "node:os";
import path from "node:path";
import process from "node:process";
import { Buffer } from "node:buffer";

export const supportedTargets = [
  { platform: "darwin", architecture: "arm64", minimumRelease: "23.0.0" },
  { platform: "win32", architecture: "x64", minimumRelease: "10.0.22000" },
];

export function assertSupportedPlatform(
  platform = process.platform,
  architecture = process.arch,
  osRelease = release(),
) {
  const target = supportedTargets.find(
    (entry) =>
      entry.platform === platform && entry.architecture === architecture,
  );
  const actual = osRelease.split(".").map(Number);
  const minimum = target?.minimumRelease.split(".").map(Number);
  const comparison =
    minimum
      ?.map((value, index) => (actual[index] ?? 0) - value)
      .find((value) => value !== 0) ?? 0;
  if (!target || comparison < 0)
    throw new Error("ADR requires macOS 14+ arm64 or Windows 11 x64.");
  return target;
}

export function nodeInvocation(entrypoint, args = []) {
  return { command: process.execPath, args: [entrypoint, ...args] };
}

// Resolve known Node CLIs, never execute a .cmd shim through a command shell.
export function commandInvocation(command, args = [], cwd = process.cwd()) {
  if (
    process.platform !== "win32" ||
    path.extname(command).toLowerCase() === ".exe"
  )
    return { command, args };
  if (command === "node") return nodeInvocation(args[0], args.slice(1));
  const name = path.basename(command).replace(/\.(cmd|bat)$/i, "");
  const packageBins = {
    pnpm: ["pnpm/bin/pnpm.cjs", "corepack/dist/pnpm.js"],
    npm: ["npm/bin/npm-cli.js", "corepack/dist/npm.js"],
    codex: ["@openai/codex/bin/codex.js"],
    "design-runtime": ["@tva-agentic-design/runtime/dist/cli.js"],
    "design-runtime-mcp": ["@tva-agentic-design/mcp/dist/cli.js"],
    "agentic-design-mcp": ["@tva-agentic-design/mcp/dist/agent-cli.js"],
    playwright: ["playwright/cli.js"],
  };
  if (!packageBins[name]) return { command, args };
  const directories = [
    path.dirname(command),
    path.join(cwd, "node_modules", ".bin"),
    path.dirname(process.execPath),
    ...(process.env.PATH ?? "").split(path.delimiter),
  ];
  for (const directory of directories) {
    const executable = path.resolve(directory, `${name}.exe`);
    if (existsSync(executable)) return { command: executable, args };
    for (const relative of packageBins[name]) {
      for (const base of [
        path.resolve(directory, "node_modules"),
        path.resolve(directory, ".."),
      ]) {
        const entrypoint = path.join(base, relative);
        if (existsSync(entrypoint)) return nodeInvocation(entrypoint, args);
      }
    }
  }
  throw new Error(
    `Cannot locate the Node entrypoint for ${name}. Install its documented prerequisite or use an explicit JavaScript CLI path.`,
  );
}

export function runCommandSync(command, args = [], options = {}) {
  const invocation = commandInvocation(command, args, options.cwd);
  return execFileSync(invocation.command, invocation.args, {
    ...options,
    windowsHide: true,
  });
}

export function installedCli(target, binary) {
  const entries = {
    "design-runtime": "@tva-agentic-design/runtime/dist/cli.js",
    "design-runtime-mcp": "@tva-agentic-design/mcp/dist/cli.js",
    "agentic-design-mcp": "@tva-agentic-design/mcp/dist/agent-cli.js",
    playwright: "playwright/cli.js",
  };
  if (!entries[binary]) throw new Error(`Unknown ADR executable: ${binary}`);
  const entrypoint = path.join(target, "node_modules", entries[binary]);
  if (
    binary === "playwright" &&
    !existsSync(entrypoint) &&
    existsSync(
      path.join(
        target,
        "node_modules",
        "@tva-agentic-design",
        "runtime",
        "package.json",
      ),
    )
  ) {
    const require = createRequire(
      path.join(
        target,
        "node_modules",
        "@tva-agentic-design",
        "runtime",
        "package.json",
      ),
    );
    return path.join(
      path.dirname(require.resolve("playwright/package.json")),
      "cli.js",
    );
  }
  return entrypoint;
}

const powershell = () =>
  path.join(
    process.env.SystemRoot ?? "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
export function windowsScript(script, input) {
  return execFileSync(
    powershell(),
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(
        `$ErrorActionPreference = 'Stop'; ${script}`,
        "utf16le",
      ).toString("base64"),
    ],
    {
      encoding: "utf8",
      windowsHide: true,
      timeout: 15000,
      env: {
        ...process.env,
        ADR_PLATFORM_INPUT: Buffer.from(JSON.stringify(input)).toString(
          "base64",
        ),
      },
    },
  ).trim();
}
const readInput =
  "$inputData = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:ADR_PLATFORM_INPUT)) | ConvertFrom-Json; $target = $inputData.path; $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User;";
const checkAcl = `
$acl = Get-Acl -LiteralPath $target;
if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) { throw 'ADR private path must be owned by the current user.' }
$hasOwner = $false;
foreach ($rule in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
  if ($rule.AccessControlType -eq 'Allow') {
    if ($rule.IdentityReference.Value -notin @($sid.Value, 'S-1-5-18', 'S-1-5-32-544')) { throw 'ADR private path grants access to another principal.' }
    if ($rule.IdentityReference.Value -eq $sid.Value -and ($rule.FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl) -eq [Security.AccessControl.FileSystemRights]::FullControl) { $hasOwner = $true }
  }
}
if (-not $hasOwner) { throw 'ADR private path does not grant the owner full control.' }
`;

export async function protectPrivatePath(target) {
  const info = await lstat(target);
  if (info.isSymbolicLink())
    throw new Error("ADR private paths cannot be symbolic links or junctions.");
  if (process.platform !== "win32") {
    await chmod(target, info.isDirectory() ? 0o700 : 0o600);
    return;
  }
  windowsScript(
    `${readInput}
$acl = Get-Acl -LiteralPath $target;
if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) { throw 'ADR cannot change protection on a path owned by another user.' }
$acl.SetAccessRuleProtection($true, $false);
foreach ($rule in @($acl.Access)) { [void]$acl.RemoveAccessRuleSpecific($rule) }
$inheritance = if ((Get-Item -LiteralPath $target).PSIsContainer) { [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit' } else { [Security.AccessControl.InheritanceFlags]::None };
$rule = [Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', $inheritance, 'None', 'Allow');
$acl.AddAccessRule($rule); Set-Acl -LiteralPath $target -AclObject $acl;
${checkAcl}`,
    { path: target },
  );
}

export async function isPrivateFile(target) {
  try {
    const info = await lstat(target);
    if (!info.isFile() || info.isSymbolicLink()) return false;
    if (process.platform !== "win32") return (info.mode & 0o077) === 0;
    windowsScript(`${readInput} ${checkAcl}`, { path: target });
    return true;
  } catch {
    return false;
  }
}

export function pathIsInside(root, candidate, platform = process.platform) {
  const paths = platform === "win32" ? path.win32 : path.posix;
  const relative = paths.relative(root, candidate);
  return (
    relative === "" ||
    (!paths.isAbsolute(relative) &&
      relative !== ".." &&
      !relative.startsWith(`..${paths.sep}`))
  );
}

export function assertPortableRelativePath(relative) {
  if (
    !relative ||
    path.posix.isAbsolute(relative) ||
    path.win32.isAbsolute(relative) ||
    /^[a-z]:/i.test(relative) ||
    relative.split(/[\\/]/).some((part) => part === "..")
  )
    throw new Error("Path must remain inside the workspace.");
  if (process.platform === "win32") assertWindowsPath(relative);
}
export function assertWindowsPath(value) {
  if (
    value
      .split(/[\\/]/)
      .some(
        (part) =>
          /[:<>"|?*]/.test(part) ||
          [...part].some((character) => character.charCodeAt(0) < 32) ||
          /[. ]$/.test(part) ||
          /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part),
      )
  )
    throw new Error(
      "Windows path contains a reserved name, stream, or unsupported character.",
    );
}
export async function assertLocalWorkspace(target) {
  if (process.platform !== "win32") return;
  const resolved = await realpath(target);
  if (!/^[a-z]:\\/i.test(resolved))
    throw new Error(
      "ADR Windows workspaces require a local NTFS drive; network paths are unsupported.",
    );
  assertWindowsPath(resolved.slice(3));
  windowsScript(
    `${readInput} $drive = [IO.DriveInfo]::new([IO.Path]::GetPathRoot($target)); if ($drive.DriveType -eq 'Network' -or $drive.DriveFormat -ne 'NTFS') { throw 'ADR Windows workspaces require a local NTFS drive.' }`,
    { path: resolved },
  );
}

export async function renameWithRetry(source, destination) {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(source, destination);
      return;
    } catch (error) {
      if (
        process.platform !== "win32" ||
        !["EPERM", "EACCES", "EBUSY"].includes(error.code) ||
        attempt >= 5
      )
        throw error;
      await new Promise((resolve) =>
        globalThis.setTimeout(resolve, 25 * 2 ** attempt),
      );
    }
  }
}

export function readPackageVersion(target, packageName) {
  return JSON.parse(
    readFileSync(
      path.join(target, "node_modules", packageName, "package.json"),
      "utf8",
    ),
  ).version;
}

export async function assertInstallationTarget(
  target,
  requireExisting = false,
) {
  const info = await lstat(target).catch((error) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (!info) {
    if (requireExisting) throw new Error("ADR installation does not exist.");
    return;
  }
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error("Installation target must be a real directory.");
  const entries = await readdir(target);
  if (!entries.length && !requireExisting) return;
  const allowed = new Set([
    "package.json",
    "pnpm-lock.yaml",
    "node_modules",
    ".runtime-archive.sha256",
  ]);
  if (entries.some((entry) => !allowed.has(entry)))
    throw new Error(
      "Installation target contains files outside the ADR installation. Move artwork out before replacing or removing it.",
    );
  const manifest = JSON.parse(
    readFileSync(
      path.join(
        target,
        "node_modules",
        "@tva-agentic-design",
        "runtime",
        "package.json",
      ),
      "utf8",
    ),
  );
  if (manifest.name !== "@tva-agentic-design/runtime")
    throw new Error("Target is not a verified ADR installation.");
}
