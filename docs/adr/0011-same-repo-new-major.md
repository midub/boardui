# 0011 Same repository, new major version

**Status:** Accepted, 2026-10-06

## Decision

- The rewrite lives in `midub/boardui`.
- Before it lands, the current Angular code is tagged `v1-angular` and kept on a `v1-angular` branch.
- `master` then becomes the rewrite.
- **Layout:** a Cargo workspace (`crates/`) and a pnpm workspace (`packages/`), with no Nx ([architecture](../architecture.md)).

## Consequences

- The name, stars, issues and history stay.
- The legacy code stays reachable from the tag and branch, without fixes.

## Alternatives considered

- **New repository, archive the old one:** loses the existing presence for no real gain.
