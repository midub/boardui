import { Color } from './color';
import { LayerType } from './layer-type';

export interface LayerTypeRenderProperties {
  layerType: LayerType;
  color?: Color;
  invisible?: boolean;
}
