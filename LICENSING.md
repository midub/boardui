# Licensing

Copyright © 2023–2026 Michal Dub.

boardui is dual-licensed. You may use it under either of these:

- **the GNU Affero General Public License, version 3 only** ([`LICENSE`](LICENSE), SPDX
  `AGPL-3.0-only`), or
- **a commercial licence** from the author.

## The AGPL

Under the AGPL, anyone may use, change and share boardui for free, commercially too, as long as
the result stays open. In short:

- If you distribute boardui or a work based on it, you must make the complete source of that work
  available under the AGPL. Serving the viewer's JavaScript and WebAssembly to users' browsers
  from your web application is distributing it.
- If you change boardui and let users interact with your version over a network, you must offer
  them its source.

The licence text decides; this summary is not legal advice.

## The commercial licence

A commercial licence lets you use boardui without the AGPL's obligations: in a closed-source
product, in a web application whose source you don't publish, or wherever your organisation
doesn't accept the AGPL. Terms and price on request: <michal@michaldub.cz>.

## Earlier versions

Releases up to and including v1.1.1 were published under the MIT licence and stay available under
it. Later releases, and `master` from the commit that added this file, are under the terms above.

## Contributions

Contributions need a signed [Contributor License Agreement](CLA.md), so that the commercial
licence can cover them too. On your first pull request, CLA Assistant asks you to sign it; see
[CONTRIBUTING.md](CONTRIBUTING.md).

## Third-party parts

Parts that boardui contains or loads keep their own licences:

- the converter's stroke font: a subset of KiCad's Newstroke, CC0 1.0
  ([`crates/boardui-convert/src/text/README.md`](crates/boardui-convert/src/text/README.md));
- occt-import-js and OpenCascade, which `@boardui/models` ships to read STEP models: LGPL-2.1,
  OpenCascade with its exception ([`packages/models/README.md`](packages/models/README.md#licences));
- the sample boards in `spec/samples` that say so, e.g.
  [`kicad-royalblue54l-feather`](spec/samples/kicad-royalblue54l-feather/README.md) (CERN-OHL-P v2);
- component models the viewer loads at runtime from KiCad's libraries: CC-BY-SA 4.0 with an
  exception for designs and generated files; they are not part of boardui;
- the Rust and npm dependencies: their own permissive licences (MIT, Apache-2.0, BSD, ISC, 0BSD,
  Unicode-3.0).
