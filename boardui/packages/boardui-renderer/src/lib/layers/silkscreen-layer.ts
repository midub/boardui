import {
  Color,
  ColorRef,
  Features,
  Layer,
  LayerFeature,
  Location,
  Step,
  Set,
} from 'boardui-parser';
import { ElementType } from '../element-type';
import '../extensions/color.extensions';
import { RenderContext } from '../render-context';
import { RendererProvider } from '../renderer-provider';
import { LayerBase } from './layer-base';
import { getSvgColor } from '../extensions/color.extensions';

export class SilkscreenLayer extends LayerBase {
  get features(): any[] {
    return this._layerFeature.sets.flatMap((x: Set) =>
      x.features.flatMap((xx: Features) => xx.features)
    );
  }

  /*
    get packageSilkscreens(): [Location, SilkScreen | null][] {
        return this._step.components
            .filter(x => x.packageRef !== null)
            .map(x => [x.location, this._renderContext.reusablesProvider.getPackageByName(x.packageRef!).silkScreen?.features ?? []]);
    }*/

  constructor(
    layer: Layer,
    step: Step,
    renderContext: RenderContext,
    private _layerFeature: LayerFeature
  ) {
    super(layer, step, renderContext, 'SILKSCREEN');
  }

  render(): SVGElement {
    const layerElement: SVGElement = document.createElementNS(
      'http://www.w3.org/2000/svg',
      'g'
    );
    //layerElement.setAttribute("id", this._renderContext.elementIdProvider.getElementId(this._layer).toString());
    layerElement.setAttribute(ElementType.LAYER, this.name);
    layerElement.setAttribute('layerType', this._layerType);

    if (this._renderProperties?.invisible) {
      layerElement.setAttribute('visibility', 'hidden');
    }

    if (this._renderProperties?.color) {
      const color = `rgb(${this._renderProperties.color.r},${this._renderProperties.color.g},${this._renderProperties.color.b})`;
      layerElement.setAttribute('fill', color);
      layerElement.setAttribute('stroke', color);
    } else {
      const color = this.getColor();
      if (color) {
        layerElement.setAttribute('fill', color);
        layerElement.setAttribute('stroke', color);
      }
    }

    for (const feature of this.features) {
      const renderer = RendererProvider.getRenderer(feature);
      renderer.render(feature, layerElement, this._renderContext);
    }

    /*
        for (const packageSilkscreen of this.packageSilkscreens){
            const renderer = RendererProvider.getRenderer(SilkScreen.prototype);
            renderer.render(packageSilkscreen, layerElement, this._renderContext);
        }
        */

    return (this._layerElement = layerElement);
  }

  private getColor(): string | null {
    const colorGroup = this._layerFeature.sets.find(
      (set) => set.colorGroups.length > 0
    )?.colorGroups[0];
    if (!colorGroup) {
      return null;
    }

    const color =
      colorGroup instanceof ColorRef
        ? this._renderContext.reusablesProvider.getColorById(colorGroup.id)
        : (colorGroup as Color);

    return getSvgColor(color);
  }
}
