import { Color } from './color';

export interface ComponentRenderProperties {
  selectors: ['refDes' | 'packageRef' | 'part' | 'mountType', string][];

  fillColor?: Color;
  outlineColor?: Color;
  visibility?: boolean;
}
