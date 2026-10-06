/**
 * The `BOARDUI_board` root extension (spec §8.3, `spec/schema/BOARDUI_board.schema.json`).
 */

/** Profile major version this viewer reads (spec §11). */
export const SUPPORTED_PROFILE_MAJOR = 0;

/** Physical role of a layer. */
export type LayerRole = 'COPPER' | 'DIELECTRIC' | 'SOLDERMASK' | 'SILKSCREEN';

/** Board side of a layer or component. */
export type Side = 'TOP' | 'BOTTOM' | 'INTERNAL';

/** One entry of `BOARDUI_board.layers`, ordered top to bottom. */
export interface BoardLayerJson {
  id: string;
  name: string;
  role: LayerRole;
  ipcFunction?: string;
  side: Side;
  zMin: number;
  zMax: number;
  thicknessSource: 'FILE' | 'DEFAULT';
  synthesized: boolean;
  /** Suggested default visibility. */
  visible: boolean;
  node: number;
  featureTable: number;
}

/** One entry of `BOARDUI_board.drills`. */
export interface BoardDrillJson {
  id: string;
  name: string;
  from: string;
  to: string;
  node: number;
  featureTable: number;
}

/** The `BOARDUI_board` extension object. */
export interface BoardExtensionJson {
  profileVersion: string;
  source: {
    format: 'IPC-2581';
    revision?: string;
    step?: string;
    functionMode?: string;
    sha256: string;
  };
  tolerance: number;
  platingThickness: number;
  thickness: number;
  layers: BoardLayerJson[];
  drills: BoardDrillJson[];
  tables: { nets: number; components: number; pins: number };
}

/**
 * Returns the `BOARDUI_board` extension of a glTF JSON document.
 *
 * @throws if the extension is missing or has an unsupported major version (spec §11).
 */
export function readBoardExtension(json: {
  extensions?: Record<string, unknown>;
}): BoardExtensionJson {
  const board = json.extensions?.BOARDUI_board as BoardExtensionJson | undefined;
  if (!board || typeof board.profileVersion !== 'string') {
    throw new Error('Not a boardui asset: the BOARDUI_board extension is missing');
  }
  const major = Number(board.profileVersion.split('.')[0]);
  if (major !== SUPPORTED_PROFILE_MAJOR) {
    throw new Error(`Unsupported boardui profile version ${board.profileVersion}`);
  }
  return board;
}
