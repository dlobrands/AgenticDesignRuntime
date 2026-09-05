# Native Windows support

ADR targets Windows 11 x64 with the same Studio, authenticated runtime, transactions,
Brand Library, rendering, exports, CLI, direct MCP, and four-skill agent plugin as
macOS. Studio runs in ADR's pinned Chromium browser. WSL and a desktop wrapper are
not required. Windows ARM64 and Windows 10 are outside this release target.

## Acceptance status

Windows support is implemented as a release target. It must not be described as
verified on Windows until the native CI and Windows 11 acceptance checks below
have passed for the exact release. A Windows Server CI runner is complementary
coverage, not a substitute for a Windows 11 user session.

## Developer installation

Install Node.js 22 or newer (release reference: 24.18.0) and pnpm 10.34.5. The
Windows installer resolves Node CLI entrypoints directly; it does not execute
package-manager command strings through cmd.exe. Standard npm/Corepack pnpm
installations and a pnpm.exe installation are supported. Use a standard user
account; administrator privileges, execution-policy changes, WSL, and Developer
Mode are not required. Package installation and Chromium download require network
access. All runtime use thereafter is local unless a requested workflow needs
external resources.

Extract the Windows x64 release, open PowerShell in that folder, and run:

```powershell
node verify-checksums.mjs .
node install-windows-release.mjs --release . --target "$env:USERPROFILE/.agentic-design-runtime/current"
node doctor-windows.mjs --target "$env:USERPROFILE/.agentic-design-runtime/current"
$adr = "$env:USERPROFILE/.agentic-design-runtime/current/node_modules/@tva-agentic-design/runtime/dist/cli.js"
node $adr start "C:/ADR/Projects/My Design" --port auto
node $adr status "C:/ADR/Projects/My Design"
node $adr stop "C:/ADR/Projects/My Design"
```

The workspace directory may be absent if its parent exists, or empty for first
initialization. Choose a local NTFS directory. UNC/network drives and other file
systems fail closed. Spaces and Unicode are supported; Windows device names,
streams, traversal, trailing dots/spaces, and junction escapes are rejected.
Existing workspace files retain canonical IDs and revisions. Move only a stopped,
fully saved workspace between machines; do not copy runtime installations or
connect two runtimes to the same workspace.

The doctor checks dependencies, private-file protection, installed executable
versions, and a disposable production-runtime render against expected pixels.
A browser-install failure is actionable failure, not successful setup. Reinstall
retains a timestamped backup. Close ADR before replacing an installation. Uninstall
moves the installation to recovery storage without deleting artwork:

```powershell
node uninstall-windows-release.mjs --target "$env:USERPROFILE/.agentic-design-runtime/current"
```

## Agents

For a direct MCP host, configure `node` with the installed
`node_modules/@tva-agentic-design/mcp/dist/cli.js` and the explicit workspace
arguments documented in the main README. Use an absolute Node path when the host
cannot inherit PATH.

The personal Codex plugin installer additionally needs Python 3 and the installed
Codex plugin-creator helpers. It discovers `python`, `python3`, or `py` on Windows:

```powershell
node install-personal-plugin.mjs
```

Start a new Codex task after installation. Confirm all four ADR skills, the
expected MCP tool surface, workspace creation/reconnect, rendered preview, exact
preview commit, and export. A self-test alone does not verify host integration.

## Filesystem and update contract

Capability descriptors and runtime-private directories use owner-controlled ACLs
on Windows. Readers verify ownership and reject access granted to unrelated
principals. No chmod-only security fallback is used on Windows. Supported
PowerShell/.NET ACL operations run noninteractively with data passed separately
from fixed scripts.

File contents are flushed before same-directory rename. Windows does not expose
directory fsync through Node's directory handles, so recovery relies on the
existing transaction journal and flushed files; no stronger power-loss guarantee
is claimed. Transient Windows rename locks receive bounded retries, and persistent
failures remain visible to callers. No delete-before-rename fallback is used.

Trusted Windows update bundles retain the signed `bin/design-runtime` entrypoint,
which contains JavaScript and is invoked through Node. macOS executable bundles
remain compatible. Platform and architecture checks, signatures, checksums,
provenance, and rollback gates remain active. Live trusted updates stay disabled
until the owner provisions the official trust configuration.

## Required acceptance evidence

Run `pnpm verify`, `pnpm test:e2e`, `pnpm pack:release`, `pnpm verify:packed`, and
`node scripts/verify-checksums.mjs release` on both supported targets. CI additionally
verifies the same packed artifacts across macOS and Windows before promotion.

On Windows 11 x64, record OS/CPU, Node/pnpm/Chromium versions, exact source and
artifact hashes, and results for:

- Clean install, missing prerequisites, checksum rejection, render doctor,
  replacement backup, rollback after failure, and recoverable uninstall.
- Start, reconnect, duplicate start, crash recovery, graceful stop, capability
  rotation, ACL rejection, spaces/Unicode, junction escape, and locked files.
- Studio editing, undo/redo, templates, plans, proposal review, exact Brand pins,
  clipboard, drag/drop, keyboard shortcuts, fonts, and export downloads.
- PNG/JPEG/WebP/SVG/CMYK PDF output: dimensions, alpha, colors, effects, typography,
  and preview/export agreement using bundled/imported fonts. Cross-OS screenshots
  may differ in rasterization; canonical content and dimensions must agree.
- Stopped-workspace round trip between macOS and Windows with unchanged canonical
  content/history hashes before editing and intact history after editing.
- Bundled skill validators, source/packed tool parity, installed-cache hashes,
  and a new native Windows Codex task exposing the expected tools and skills.

Publishing, plugin installation, and live update configuration require owner
authorization. Do not infer Windows verification from macOS test results.

## Windows validation handoff

Copy the complete source checkout (including local changes) to a Windows 11 x64
machine with Git, Node and pnpm installed. Open PowerShell in the repository root:

```powershell
node scripts/validate-windows.mjs
```

This runs dependency installation, pinned Chromium installation, verification,
E2E, packaging, fresh packed-install checks, and checksums. It writes timestamped
logs and `acceptance.json` under `test-results/windows-acceptance-*`, including
source commit/content hashes, machine versions, command outcomes and artifact
hashes. It does not publish, change live update trust, or install a personal plugin.

Return the acceptance report and logs for review. The report explicitly lists the
remaining interactive Studio, macOS/Windows workspace transfer, and fresh Codex
task checks. Complete those separately; an automated pass is not full acceptance.
