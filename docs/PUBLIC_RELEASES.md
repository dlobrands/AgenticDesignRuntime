# Public production releases

ADR uses one development authority and one production mirror.

- `dlobrands/AgenticDesignRuntime-Internal` is private and owns development,
  testing, review, and release authorization.
- `dlobrands/AgenticDesignRuntime` is public, proprietary, and receives only
  sanitized snapshots of protected stable tags.
- Changes never flow directly from public source into production. A useful
  report or patch is reproduced privately, verified, and included in a later
  protected release.

The public snapshot starts with fresh public history and includes a
`PUBLIC_SOURCE_MANIFEST.json` binding every file to its SHA-256 digest and the
authorized private source commit. Private branches and Git objects are never
copied.

## Release gate

Publication is a manual private-default-branch action, not a tag-push side
effect. The dispatch is accepted only from the repository-owner identity and
must provide the exact current private `main` commit, the exact version in
`product-metadata.json`, and the confirmation `PUBLISH ADR vX.Y.Z`. The target
version must not exist in either private or public tag history. Private
quality, browser, packed-install, checksum, SBOM, provenance, and
representative-design gates run first. The sanitized snapshot then repeats its
source gates before GitHub or npm publication. The GitHub Environment records
the deployment; the explicit owner dispatch is the authorization boundary when
paid private-environment review protection is unavailable.

GitHub Releases contain the macOS arm64 bundle, component tarballs, plugin,
installer, checksums, release manifest, SBOM, and provenance. npm publishes the
exact-version public package family with provenance. Studio remains a private
workspace package bundled inside `@agentic-design/runtime`.

Automatic trusted updates remain disabled until an official origin, signing
custody, protected-tag governance, and verification identity are separately
bound. Users install an exact release explicitly and verify checksums.
