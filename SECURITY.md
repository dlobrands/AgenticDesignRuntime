# Security policy

## Supported releases

Only the latest stable macOS Apple Silicon release published from the public
`dlobrands/AgenticDesignRuntime` repository is supported. Development snapshots,
older releases, Intel Macs, Windows, and Linux are not security-supported.

## Report a vulnerability privately

Use GitHub Private Vulnerability Reporting on the public repository. Do not put
an exploit, capability token, runtime descriptor, private filesystem path, user
artwork, or workspace contents in a public issue.

Include the affected exact version, macOS version and architecture, a minimal
reproduction, expected impact, and redacted diagnostics when useful. The owner
will acknowledge a valid report through GitHub, assess severity, and coordinate
disclosure. No fixed response-time SLA is promised during personal-evaluation
availability.

## Security boundaries

ADR is local-first but not anonymous. Its loopback runtime uses capability and
browser-session authentication. Workspace files, imported assets, fonts, and
exports remain sensitive user data. Support diagnostics intentionally exclude
scene contents, assets, fonts, copy, descriptors, and capability tokens.
