# 0004 Converter in Rust: native CLI and WebAssembly

**Status:** Accepted, 2026-10-06

## Context

Conversion should run in the browser, so boards never get uploaded, and as a CLI. Options were TypeScript everywhere, Rust compiled to WASM plus native, or .NET.

## Decision

The converter is written in Rust. It ships as:

- a native CLI (`boardui`);
- a WASM module (`boardui-wasm` → `@boardui/converter`) that runs in a Web Worker.

## Consequences

- The IPC-2581 parser is rewritten in Rust. The old TS parser stays useful as a cross-check on test files.
- There are two toolchains (Cargo, pnpm). The viewer stays TypeScript ([ADR 0009](0009-viewer-three-js-web-component.md)).
- Native builds can parallelize (`rayon`). WASM is single-threaded in v1.
- WASM tooling: `wasm-bindgen` and `wasm-opt`; not wasm-pack (single maintainer since the rustwasm org was wound down in 2025).

## Alternatives considered

- **TypeScript everywhere:** one language and the parser carries over, but slower on large boards.
- **.NET:** no in-browser conversion without Blazor; it would need a server.
