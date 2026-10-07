# 0014 Runtime model sources

**Status:** Accepted, 2026-10-07. Extends [ADR 0007](0007-component-bodies.md).

## Context

Boards look like boards only with real component models. IPC-2581 carries none, and ADR 0007
left them to the user: GLB files mapped by part or package and embedded by the converter
(`--models`). For KiCad boards, most models exist already: KiCad's libraries
(`gitlab.com/kicad/libraries`, CC-BY-SA 4.0 with an exception for designs) have a STEP model
for nearly every footprint, and KiCad's IPC-2581 export names the footprint of every component
(`Package@name` = `<footprint>_<n>`, `Component@part` = `<library>_<footprint>_<value>`). Other
providers (EasyEDA for LCSC parts, a company's own model server) work the same way: a lookup by
some name, then a file.

## Decision

- **The viewer loads models at runtime from servers**, after a board loads, instead of
  converting them beforehand. There is no model pack to host or keep current, no conversion
  step in CI or Docker, and boards converted before keep working.
- **Pluggable sources.** A `ModelSource` resolves a component (with its BOM attributes, spec
  §8.4) and the board (with its exporting software, §8.3) to a `ModelRef`: a key, a URL or a
  loader, a format and a transform into the package frame. The viewer tries its sources in order,
  falls through on misses and failures, never replaces models embedded by the converter, and
  caches what it fetched (and parsed) in Cache Storage. The mechanism and the glTF loader are in
  `@boardui/viewer`; sources and other formats are separate.
- **STEP in the browser** via occt-import-js (OpenCascade compiled to WebAssembly, LGPL-2.1), in
  a Web Worker loaded on first use, in a separate package (`@boardui/models`). The converter
  stays pure Rust ([ADR 0005](0005-2-5d-geometry-in-pure-rust.md)); the viewer doesn't depend
  on OpenCascade, so apps without STEP don't ship 7.6 MB of WebAssembly.
- **KiCad via the GitLab API.** `kicadSource` reads the footprint's `.kicad_mod` and the model
  through GitLab's API files endpoint, which allows cross-origin requests, at the library tag of
  the KiCad version that exported the board, placing the model as KiCad does. It only asks for
  footprints of KiCad's own libraries (a pinned list), at most four requests at a time, and
  stops on HTTP 429.
- **Own servers** through the model mapping file, read at runtime (`mappingSource`), extended
  compatibly with wildcards, `refDes` and attribute matches, URLs, templates and STEP/OBJ files.
  The converter skips such rules with a warning.
- The profile doesn't change: runtime models are viewer behaviour (spec §6.15, informative).

## Consequences

- The demos show KiCad boards with real models without any setup; the first load of a board
  fetches about two files per distinct footprint from gitlab.com (and the board's footprint
  names go there), later loads come from the cache.
- Models depend on a third-party service being up and its API staying as it is; a
  `baseUrl` lets a caching proxy or mirror stand in. Without network, placeholders stay.
- Runtime models aren't part of the GLB: exporting or downloading the board doesn't include
  them, and other glTF viewers show placeholders.
- An EasyEDA source is possible later (LCSC numbers from the BOM attributes, a CORS proxy for the
  lookup, OBJ/STEP from `modules.easyeda.com`) without touching the viewer.

## Alternatives considered

- **Convert KiCad's library to GLB and host a model pack:** a large, versioned artefact to build,
  host and keep in sync with KiCad's tags, under CC-BY-SA; the converter would still need STEP
  or a pipeline outside it.
- **STEP in the converter (Rust):** no mature pure-Rust STEP tessellator; OpenCascade in the
  converter breaks ADR 0005.
- **Raw files (`/-/raw/` URLs) or GitHub mirrors:** no CORS headers on gitlab.com's raw URLs;
  mirrors lag and change.
- **Embedding runtime models into the GLB:** out of scope for now; the converter's `--models`
  does it for local glTF files.
