# 0015 Licence: AGPL-3.0 plus a commercial licence

**Status:** Accepted, 2026-10-07. Supersedes the licence point of [ADR 0001](0001-purpose-and-scope.md).

## Context

ADR 0001 kept boardui under MIT, as a hobby project without commercial constraints. Michal now
wants companies that build boardui into their products to pay for it, while it stays free for
hobbyists, students and open-source projects. Michal is the only copyright holder: every commit
is Michal's and nobody else has contributed, so the licence can change without anyone else's
consent.

## Decision

- **Dual licence.** Everyone may use boardui under the AGPL-3.0-only (`LICENSE`); anyone who
  doesn't want the AGPL's obligations can buy a commercial licence from Michal (`LICENSING.md`).
  It covers the whole repository (converter, viewer, framework wrappers, demos and spec), except
  third-party parts with their own licences.
- **`AGPL-3.0-only`, not `-or-later`:** a future AGPL version can't change the open-source terms.
- **Contributions need a CLA** (`CLA.md`, signed through CLA Assistant), so that the commercial
  licence can cover them too.
- **Releases up to v1.1.1 stay MIT.** The new licence applies from the commit that adds
  `LICENSING.md` and from the next release on.

## Consequences

- Closed-source products, and web applications that serve the viewer without publishing their
  source, need the commercial licence.
- Anyone who complies with the AGPL may use boardui commercially, including in an open-source
  product they sell or host. That is accepted: it is what makes boardui open source. Unmodified
  use inside an organisation creates no obligations either.
- v1.1.1 and earlier stay MIT, so anyone may keep building on them.
- Every contributor has to sign the CLA, which may put some off.
- The dependencies stay compatible: the Rust and npm dependencies are permissive (MIT,
  Apache-2.0, BSD, ISC, 0BSD, Unicode-3.0), occt-import-js and OpenCascade in `@boardui/models`
  are LGPL-2.1, and the converter's stroke font is CC0.
- The demos' footnote and the release archives (`LICENSING.md` next to `LICENSE`) point to the
  commercial licence.

## Alternatives considered

- **Keep MIT and sell support or paid extras:** gives companies no reason to pay for the core.
- **Business Source License 1.1** (free non-commercial production use, each version AGPL after
  four years): would also make companies pay that could comply with an open-source licence,
  including open-source products that earn money, but boardui would stop being open source, and
  Linux distributions and GPL projects such as KiCad couldn't include current versions.
  Rejected (Michal's decision).
- **PolyForm Noncommercial or Small Business:** the same trade-off as BSL, without the later
  conversion to open source.
- **AGPL plus a "no selling" clause (Commons Clause):** AGPL §7 lets recipients remove further
  restrictions, and the result isn't open source either.
