/**
 * The `BOARDUI_board` root extension (spec §8.3, `spec/schema/BOARDUI_board.schema.json`).
 */

/** Profile major version this viewer reads (spec §11). */
export const SUPPORTED_PROFILE_MAJOR = 0;

/** Role of a layer (spec §8.3). */
export type LayerRole =
  | 'COPPER'
  | 'DIELECTRIC'
  | 'SOLDERMASK'
  | 'SILKSCREEN'
  | 'PASTE'
  | 'COURTYARD'
  | 'ASSEMBLY'
  | 'DOCUMENTATION';

/** Roles of drawing layers (spec §6.12): courtyard, assembly and documentation. */
export const DRAWING_ROLES: ReadonlySet<LayerRole> = new Set([
  'COURTYARD',
  'ASSEMBLY',
  'DOCUMENTATION',
]);

/** Roles of the optional layers (spec §6.11, §6.12), hidden by default. */
export const OPTIONAL_ROLES: ReadonlySet<LayerRole> = new Set([...DRAWING_ROLES, 'PASTE']);

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
  /** Absent when the layer has no features (property tables can't be empty). */
  featureTable?: number;
}

/** One entry of `BOARDUI_board.drills`. */
export interface BoardDrillJson {
  id: string;
  name: string;
  from: string;
  to: string;
  node: number;
  /** Absent when the drill layer has no holes. */
  featureTable?: number;
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
    /** The software that wrote the source file (spec §8.3, profile 0.8). */
    software?: { name: string; revision?: string; vendor?: string };
  };
  tolerance: number;
  platingThickness: number;
  thickness: number;
  layers: BoardLayerJson[];
  drills: BoardDrillJson[];
  /** A table without rows is omitted (spec §8.2). */
  tables: {
    nets?: number;
    components?: number;
    pins?: number;
    instances?: number;
    /** Since profile 0.8. */
    attributes?: number;
  };
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
