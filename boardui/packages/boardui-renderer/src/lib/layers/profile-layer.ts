import { Layer, Step } from 'boardui-parser';
import { ElementType } from '../element-type';
import { RenderContext } from '../render-context';
import { RendererProvider } from '../renderer-provider';
import { LayerBase } from './layer-base';

export class ProfileLayer extends LayerBase {
  constructor(layer: Layer, step: Step, renderContext: RenderContext) {
    super(layer, step, renderContext, 'PROFILE');
  }

  render(): SVGElement {
    const profileLayerElement: SVGElement = document.createElementNS(
      'http://www.w3.org/2000/svg',
      'g'
    );
    //profileLayerElement.setAttribute("id", this._renderContext.elementIdProvider.getElementId(this._layer).toString());
    profileLayerElement.setAttribute(ElementType.LAYER, this._layerType);
    profileLayerElement.setAttribute('layerType', this._layerType);

    if (this._renderProperties?.invisible) {
      profileLayerElement.setAttribute('visibility', 'hidden');
    }

    if (this._renderProperties?.color) {
      const color = `rgb(${this._renderProperties.color.r},${this._renderProperties.color.g},${this._renderProperties.color.b})`;
      profileLayerElement.setAttribute('fill', color);
      profileLayerElement.setAttribute('stroke', color);
    } else {
      profileLayerElement.setAttribute('fill', 'none');
      profileLayerElement.setAttribute('stroke', 'none');
    }

    const profileRenderer = RendererProvider.getProfileRenderer(
      this._step.profile!
    );
    profileRenderer.render(
      this._step.profile!,
      profileLayerElement,
      this._renderContext
    );

    return profileLayerElement;
  }
}
