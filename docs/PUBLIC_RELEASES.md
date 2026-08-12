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
workspace package bundled inside `@tva-agentic-design/runtime`.

## npm identity and trusted publisher

The owner-controlled npm organization is `tva-agentic-design`. The public
package family is:

- `@tva-agentic-design/core`
- `@tva-agentic-design/client`
- `@tva-agentic-design/renderer-pixi`
- `@tva-agentic-design/runtime`
- `@tva-agentic-design/mcp`

Each package uses the same trusted-publisher identity: GitHub owner
`dlobrands`, public repository `AgenticDesignRuntime`, workflow
`publish-npm.yml`, environment `public-production`, and allowed action
`npm publish`. The private promotion workflow alone may create the exact public
source tag and dispatch this public workflow. npm exposes this
package-level setting only after the package exists, so the first version was
published through interactive owner authentication and 2FA. OIDC was then
configured for all five packages. No npm token is stored in source or retained
as the normal release path.

Version `1.0.1` is the one-time interactive 2FA bootstrap and therefore does
not carry OIDC provenance. All five packages now trust the public workflow for
future `npm publish` actions. The `public-production` environment accepts only
stable tag refs matching `v*.*.*`; ordinary branches cannot acquire its OIDC
publishing identity.

Promotion is safely repeatable after a partial npm failure. For each exact
version, the workflow publishes only an absent package. If a version already
exists, its registry SHA-512 integrity must match the locally packed archive
exactly; a mismatch or any lookup failure other than `E404` stops publication.

The public workflow identity must match each package's public
`repository.url`. Binding npm to the private development repository would make
that identity inconsistent and would prevent public-repository provenance.

Automatic trusted updates remain disabled until an official origin, signing
custody, protected-tag governance, and verification identity are separately
bound. Users install an exact release explicitly and verify checksums.
