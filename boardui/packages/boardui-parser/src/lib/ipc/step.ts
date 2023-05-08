import { Component } from './component';
import { Contour } from './contour';
import { LayerFeature } from './layer-feature';
import { Package } from './package';

export class Step {
  name: string = null!;
  profile: Contour | null = null;
  layerFeatures: LayerFeature[] = [];
  packages: Package[] = [];
  components: Component[] = [];
}
