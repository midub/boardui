import {
  Color,
  ColorRef,
  Layer,
  LayerFeature,
  Pad,
  Step,
} from 'boardui-parser';
import { ElementType } from '../element-type';
import '../extensions/color.extensions';
import { RenderContext } from '../render-context';
import { RendererProvider } from '../renderer-provider';
import { LayerBase } from './layer-base';
import { getSvgColor } from '../extensions/color.extensions';

export class ConductorLayer extends LayerBase {
  get features(): any[] {
    return this._layerFeature.sets.flatMap((x) =>
      x.features.flatMap((xx) => xx.features)
    );
  }

  get pads(): Pad[] {
    return this._layerFeature.sets.flatMap((x) => x.pads);
  }

  constructor(
    layer: Layer,
    step: Step,
    renderContext: RenderContext,
    private _layerFeature: LayerFeature
  ) {
    super(layer, step, renderContext, 'SIGNAL');
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

    const padRenderer = RendererProvider.getRenderer(Pad.prototype);
    for (const pad of this.pads) {
      padRenderer.render(pad, layerElement, this._renderContext);
    }

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
