# Support policy

## Supported production configuration

- Apple Silicon Mac (`arm64`), macOS 14 or newer; or Windows 11 x64
- Windows workspaces on local NTFS volumes; see [Windows acceptance status](./docs/WINDOWS_SUPPORT.md)
- Node.js 22 or newer; release reference Node 24.18.0
- pnpm 10.34.5
- The Chromium revision installed by the exact ADR release
- The latest stable runtime, MCP, and Codex plugin combination

Intel Macs, Windows ARM64, Windows 10, Linux, mobile platforms, modified builds, and mixed-version
runtime/plugin installations are unsupported. They may fail installation rather
than run with unverified behavior.

Use public GitHub Issues for reproducible non-sensitive defects and Discussions
for usage questions. Use private vulnerability reporting for security issues.
Never attach a real workspace, user artwork, runtime descriptor, or token.

The personal-evaluation license does not include a support SLA. Commercial
support requires a separate written agreement.
