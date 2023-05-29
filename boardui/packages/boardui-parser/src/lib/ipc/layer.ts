import { Contour } from './contour';
import { LayerFunction } from './layer-function';
import { Polarity } from './polarity';
import { Side } from './side';
import { Span } from './span';

export class Layer {
  name: string = null!;
  layerFunction: LayerFunction = null!;
  side: Side = null!;
  polarity: Polarity = null!;
  span: Span | null = null;
  profiles: Contour[] = [];
}
