# @boardui/converter

Converts IPC-2581 to a boardui glTF board ([profile spec](../../spec/README.md)) in the browser.
The Rust converter (`crates/boardui-wasm`) runs as WebAssembly in a Web Worker: the input is
transferred in, progress events stream out, and the GLB is transferred back. Nothing leaves the
machine.

```ts
import { convertIpc2581, validateGlb } from '@boardui/converter';

const { glb, warnings, stats, timings } = await convertIpc2581(file, {
  tolerance: 5e-6, // metres, the default
  models: { mapping: modelsJsonFile, files: [r0603Gltf] },
  onProgress: ({ step, fraction }) => console.log(step, fraction),
  signal: abortController.signal,
});
const report = await validateGlb(glb.slice(0)); // { valid, errors, issues }
```

`<board-viewer>` wraps this as `viewer.loadIpc2581(file, options)` (see `packages/viewer`).

## API

| | |
|---|---|
| `convertIpc2581(input, options)` | `input`: a `File`/`Blob` (read in the worker) or bytes (an `ArrayBuffer` is transferred and detached, a `Uint8Array` copied). Resolves with `{ glb, warnings, stats, timings, seconds, wasmMemory }`; rejects with a `ConvertError` carrying the converter's message, or an `AbortError` when `signal` aborts. |
| `validateGlb(glb)` | Checks a GLB against the profile rules (spec §10) in a worker; the Khronos validator is not run. |
| options | `tolerance`, `platingThickness` (metres), `step`, `models`, `onProgress`, `signal` |
| `models` | `{ mapping, files }`: the mapping (`spec/schema/models.schema.json`) as a `File`, JSON text or object, and the glTF/GLB files it names (plus `.bin` buffers and textures). Files are matched by their path relative to the mapping (from `webkitRelativePath` when a folder was picked), else by name. |
| `onProgress` | `{ step, index, count, fraction }` when each pipeline step starts (`parse`, `stack-up, features, components`, `resolve`, `hole cuts`, `cut and sheets`, `extrude`, `barrels`, `write`); `fraction` is an estimate of the work done. |

Each call starts its own worker and terminates it afterwards: WebAssembly memory only grows, and
a large board takes gigabytes (`wasmMemory` reports the peak). The module is 32-bit, so a
conversion has at most 4 GiB; the ~240k-feature synthetic board needs 3.1 GB.

`@boardui/converter/core` runs the bindings on bytes without a worker (Node, tests), and
`@boardui/converter/wasm` is the wasm-bindgen module itself.

## Build

`pnpm build` runs `scripts/build-wasm.mjs`, then `tsc`:

1. `cargo build -p boardui-wasm --target wasm32-unknown-unknown --release --locked`;
2. `wasm-bindgen --target web` into `wasm/` (the CLI version must match the `wasm-bindgen` crate in
   `Cargo.lock`, currently 0.2.129; it is looked up on `PATH` and in `target/tools/bin`);
3. `wasm-opt -O3` when binaryen's `wasm-opt` is on `PATH`.

The module is **1.62 MB** (0.56 MB gzipped) after `wasm-opt`, 2.15 MB before.

## Tests and measurements

- `pnpm test`: Node smoke test (Vitest) that converts hand-written samples with the built module,
  checks progress events and timings, compares a GLB with the native converter's, applies options
  and a model mapping, and checks errors and validation.
- `node scripts/perf.mjs <file.xml>…`: converts in Node and prints one JSON line per file: total
  and per-step seconds, features, triangles, GLB size and peak WebAssembly memory.
