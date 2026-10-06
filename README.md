<div align="center">
  <img src="logo.svg" alt="BoardUI logo" width="80" height="80">
  <h3>BoardUI</h3>
  <p>Printed circuit boards in 3D, in the browser: IPC-2581 in, glTF out, and an interactive viewer.</p>
</div>

> **Status:** rewrite in progress. The original Angular/SVG viewer (2023 bachelor thesis) lives at the [`v1-angular`](https://github.com/midub/boardui/tree/v1-angular) tag and branch.

## What it will be

- **Converter (Rust).** Turns an IPC-2581 file into a glTF board that any glTF viewer can open. The board carries metadata: components, pins, nets and every pad and trace, so viewers can highlight elements and attach widgets to them. It runs as a command-line tool and as WebAssembly in the browser, so boards never have to be uploaded anywhere.
- **Viewer (TypeScript + three.js).** `<board-viewer>`, a framework-independent web component. It covers layer toggles, x-ray, hover and selection, net highlighting, and HTML widgets anchored to board elements.

## Design

- [glTF profile spec](spec/README.md): how a board is represented in glTF
- [Architecture and tech stack](docs/architecture.md)
- [Roadmap](docs/roadmap.md)
- [Architecture decision records](docs/adr/README.md)

## Repository layout

| Path | Contents |
|---|---|
| `crates/boardui-ipc2581` | IPC-2581 reader |
| `crates/boardui-geom` | board geometry |
| `crates/boardui-gltf` | glTF profile writer |
| `crates/boardui-convert` | conversion pipeline and validation |
| `crates/boardui` | `boardui` command-line tool |
| `crates/boardui-wasm` | WebAssembly bindings |
| `packages/converter` | `@boardui/converter`: converter in a Web Worker |
| `packages/viewer` | `@boardui/viewer`: `<board-viewer>` |
| `packages/demo` | demo app |
| `spec/` | profile spec, JSON schemas, sample boards |

## Command-line tool

```sh
cargo install --path crates/boardui            # or: cargo run --release -p boardui -- …
boardui convert board.xml -o board.glb         # IPC-2581 in, boardui GLB out
boardui convert board.xml -o board.glb --models models.json   # user models for component bodies
boardui validate board.glb                     # profile rules (spec §10), plus the Khronos
                                               # validator when gltf_validator is on PATH
```

`boardui -v convert …` prints the time of each pipeline step. The samples in [`spec/samples`](spec/samples/README.md) double as the conformance suite.

## Development

Prerequisites: [rustup](https://rustup.rs) (the toolchain version is pinned in `rust-toolchain.toml` and installed automatically), Node.js 24 and pnpm (`corepack enable`).

```sh
# Rust
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo build -p boardui-wasm --target wasm32-unknown-unknown --release

# Web
pnpm install
pnpm lint
pnpm build
pnpm test
```

## License

[MIT](LICENSE)
