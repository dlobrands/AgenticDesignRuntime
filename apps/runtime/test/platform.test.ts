import { afterEach, describe, expect, it } from "vitest";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  assertSupportedPlatform,
  assertWindowsPath,
  assertPortableRelativePath,
  pathIsInside,
  protectPrivatePath,
  isPrivateFile,
  commandInvocation,
  assertInstallationTarget,
  windowsScript,
} from "../../../scripts/platform.mjs";
import { resolveInside, writeJsonAtomic } from "../src/fs-safe.js";
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
const temporary = async () => {
  const root = await mkdtemp(path.join(tmpdir(), "adr Windows ü-"));
  roots.push(root);
  return root;
};
describe("supported platforms", () => {
  it("accepts precisely the supported OS/CPU combinations and minimum versions", () => {
    expect(() =>
      assertSupportedPlatform("win32", "x64", "10.0.22000"),
    ).not.toThrow();
    expect(() =>
      assertSupportedPlatform("darwin", "arm64", "23.0.0"),
    ).not.toThrow();
    for (const [os, cpu, version] of [
      ["win32", "arm64", "10.0.26000"],
      ["win32", "x64", "10.0.19045"],
      ["darwin", "x64", "24.0.0"],
      ["darwin", "arm64", "22.6.0"],
      ["linux", "x64", "6.0.0"],
    ])
      expect(() => assertSupportedPlatform(os, cpu, version)).toThrow();
  });
  it.each([
    "C:secret",
    "C:\\secret",
    "\\\\server\\share",
    "../secret",
    "a\\..\\secret",
  ])("rejects cross-platform path escape %s", (value) =>
    expect(() => assertPortableRelativePath(value)).toThrow(),
  );
  it.each([
    "CON",
    "con.png",
    "LPT1.txt",
    "file:stream",
    "trailing.",
    "trailing ",
    "a/b?.png",
  ])("rejects Windows aliases and streams %s", (value) =>
    expect(() => assertWindowsPath(value)).toThrow(),
  );
  it("compares Windows paths by components and handles case aliases", () => {
    expect(pathIsInside("C:\\Work", "c:\\work\\Project", "win32")).toBe(true);
    expect(pathIsInside("C:\\Work", "C:\\Workspace", "win32")).toBe(false);
    expect(pathIsInside("C:\\Work", "D:\\Work", "win32")).toBe(false);
  });
});
describe("native filesystem and security", () => {
  it("persists replacements in Unicode and spaced paths", async () => {
    const root = await temporary();
    const file = path.join(root, "scene.json");
    await writeJsonAtomic(file, { revision: 1 });
    await writeJsonAtomic(file, { revision: 2 });
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ revision: 2 });
  });
  it("protects new descriptor files before discovery", async () => {
    const root = await temporary();
    await protectPrivatePath(root);
    const file = path.join(root, "descriptor.json");
    await writeFile(file, "{}", { mode: 0o600 });
    expect(await isPrivateFile(file)).toBe(true);
  });
  it("rejects junction and symlink escapes", async () => {
    const root = await temporary();
    const outside = await temporary();
    await writeFile(path.join(outside, "private"), "secret");
    await symlink(
      outside,
      path.join(root, "escape"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await expect(resolveInside(root, "escape/private")).rejects.toMatchObject({
      code: "PATH_OUTSIDE_WORKSPACE",
    });
    await expect(
      protectPrivatePath(path.join(root, "escape")),
    ).rejects.toThrow();
  });
  it("refuses to replace or uninstall a directory containing artwork", async () => {
    const root = await temporary();
    await writeFile(path.join(root, "design.config.json"), "preserve");
    await expect(assertInstallationTarget(root)).rejects.toThrow(
      /outside the ADR installation/,
    );
    expect(await readFile(path.join(root, "design.config.json"), "utf8")).toBe(
      "preserve",
    );
  });
  it.skipIf(process.platform !== "win32")(
    "rejects a descriptor readable by unrelated users",
    async () => {
      const root = await temporary();
      await protectPrivatePath(root);
      const file = path.join(root, "descriptor.json");
      await writeFile(file, "{}");
      windowsScript(
        `$inputData = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:ADR_PLATFORM_INPUT)) | ConvertFrom-Json;
      $acl = Get-Acl -LiteralPath $inputData.path;
      $everyone = [Security.Principal.SecurityIdentifier]::new('S-1-1-0');
      $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($everyone, 'Read', 'Allow'));
      Set-Acl -LiteralPath $inputData.path -AclObject $acl;`,
        { path: file },
      );
      expect(await isPrivateFile(file)).toBe(false);
    },
  );
  it.skipIf(process.platform !== "win32")(
    "resolves package executables without .cmd or a shell",
    async () => {
      const root = await temporary();
      const directory = path.join(
        root,
        "node_modules",
        "@tva-agentic-design",
        "runtime",
        "dist",
      );
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, "cli.js"), "");
      const invocation = commandInvocation(
        "design-runtime",
        ["--version"],
        root,
      );
      expect(invocation.command).toBe(process.execPath);
      expect(invocation.args).toEqual([
        path.join(directory, "cli.js"),
        "--version",
      ]);
    },
  );
});
