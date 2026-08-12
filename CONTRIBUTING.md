# Contributing

Agentic Design Runtime is a local-first structured design system. Changes must preserve editable canonical documents, deterministic semantic history, and parity between Studio, HTTP, CLI, and MCP operations.

## Development workflow

1. Use Node.js 22 or newer and the pnpm version declared in `package.json`.
2. Install dependencies with `pnpm install --frozen-lockfile`.
3. Add focused regression coverage with every behavior change.
4. Run `pnpm verify` and `pnpm test:e2e` before proposing a merge.
5. For release-affecting work, also run `pnpm verify:packed` and verify the generated checksums from an isolated install.

Do not manually edit canonical workspace history or bypass the runtime transaction boundary. Never commit credentials, runtime descriptors, capability tokens, user workspaces, generated exports, or recovery evidence.

## Changes and reviews

Keep pull requests narrowly scoped. Describe the user-visible outcome, contract or migration changes, tests run, and any security implications. Security-sensitive import, persistence, recovery, and update paths require explicit review before release.

The public repository is a production source mirror and does not merge code
directly. Report reproducible defects through Issues or propose a bounded change
through Discussions. Accepted work is independently reproduced in the private
development authority and promoted only through a later verified stable release.

## Reporting security issues

Do not open a public issue containing an exploit, token, private workspace path, or user design data. The private reporting destination will be documented in `SECURITY.md` once project ownership provides an approved security contact.
