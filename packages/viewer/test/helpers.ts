/** Shared helpers for the viewer tests. */

/** The parts of the glTF JSON the tests look at. */
export interface TestGltfJson {
  extensionsUsed: string[];
  extensionsRequired?: string[];
  extensions: Record<string, unknown> & { BOARDUI_board: unknown };
  nodes: { name: string; children?: number[]; extras?: unknown }[];
}

/** Reads the JSON chunk of a GLB. */
export function glbJson(glb: Uint8Array): TestGltfJson {
  const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  const length = view.getUint32(12, true);
  return JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + length)));
}
