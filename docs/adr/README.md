# Architecture decision records

Each record captures one decision from the 3D rewrite design. Format: context, decision, consequences, alternatives considered. A changed decision gets a new record that supersedes the old one; old records are never rewritten.

| # | Decision | Status |
|---|---|---|
| [0001](0001-purpose-and-scope.md) | Hobby project built to product standards; viewer and tooling, no editing | Accepted |
| [0002](0002-gltf-is-an-export-with-metadata.md) | glTF is an export with metadata; IPC-2581 stays the source of truth | Accepted |
| [0003](0003-ipc-2581-only-input.md) | IPC-2581 is the only input format | Accepted |
| [0004](0004-converter-in-rust.md) | Converter in Rust: native CLI and WebAssembly | Accepted |
| [0005](0005-2-5d-geometry-in-pure-rust.md) | 2.5D geometry with pure-Rust dependencies | Accepted |
| [0006](0006-full-stack-up-geometry.md) | Full stack-up at real heights, realistic materials | Accepted |
| [0007](0007-component-bodies.md) | Placeholder bodies plus user-supplied GLB models | Accepted |
| [0008](0008-hybrid-metadata.md) | Hybrid metadata: component nodes, merged layer meshes with feature IDs | Accepted |
| [0009](0009-viewer-three-js-web-component.md) | Viewer: TypeScript, three.js, web component | Accepted |
| [0010](0010-v1-scope.md) | v1 tool set | Accepted |
| [0011](0011-same-repo-new-major.md) | Same repository, new major version | Accepted |
| [0012](0012-spec-format.md) | Spec format | Accepted |
