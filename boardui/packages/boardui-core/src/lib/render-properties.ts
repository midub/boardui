import { ComponentRenderProperties } from './component-render-properties';
import { LayerTypeRenderProperties } from './layer-type-render-properties';

export interface RenderProperties {
  padding: number;
  dropShadow?: {
    dx: number;
    dy: number;
    stdDeviation: number;
  };
  layerTypesRenderProperties: LayerTypeRenderProperties[];
  componentRenderProperties: ComponentRenderProperties[];
}
