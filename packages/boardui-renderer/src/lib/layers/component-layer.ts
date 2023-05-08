import { RendererProvider } from '../renderer-provider';
import { Component, Layer, Step } from 'boardui-parser';
import { LayerBase } from './layer-base';
import { ElementType } from '../element-type';
import { RenderContext } from '../render-context';

export class ComponentLayer extends LayerBase {
  constructor(layer: Layer, step: Step, renderContext: RenderContext) {
    super(layer, step, renderContext, 'COMPONENT');
  }

  private get components(): Component[] {
    return this._step.components.filter((x) => x.layerRef === this._layer.name);
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
    }

    for (const component of this.components) {
      const renderer = RendererProvider.getRenderer(component);
      renderer.render(component, layerElement, this._renderContext);
    }

    return (this._layerElement = layerElement);
  }
}
