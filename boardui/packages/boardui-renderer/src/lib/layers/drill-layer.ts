import { Hole, Layer, LayerFeature, Set, Step } from 'boardui-parser';
import { Bounds } from '../bounds';
import { RenderContext } from '../render-context';
import { RendererProvider } from '../renderer-provider';
import { LayerBase } from './layer-base';

export class DrillLayer extends LayerBase {
  constructor(
    layer: Layer,
    step: Step,
    renderContext: RenderContext,
    private _layerFeature: LayerFeature,
    private _bounds: Bounds
  ) {
    super(layer, step, renderContext, 'DRILL');
  }

  get drills(): Hole[] {
    return this._layerFeature.sets.flatMap((x: Set) => x.holes);
  }

  render(): SVGElement {
    const maskElement: SVGElement = document.createElementNS(
      'http://www.w3.org/2000/svg',
      'mask'
    );
    maskElement.setAttribute(
      'id',
      this._renderContext.elementIdProvider.getElementId(this._layer).toString()
    );
    maskElement.setAttribute('layer', this.name);
    maskElement.setAttribute('layerType', this._layerType);

    if (this._renderProperties?.invisible) {
      maskElement.setAttribute('visibility', 'hidden');
    }

    const rectElement: SVGElement = document.createElementNS(
      'http://www.w3.org/2000/svg',
      'rect'
    );
    rectElement.setAttribute('width', this._bounds.width.toString());
    rectElement.setAttribute('height', this._bounds.height.toString());
    rectElement.setAttribute('fill', 'white');
    rectElement.setAttribute('x', this._bounds.offsetX.toString());
    rectElement.setAttribute('y', this._bounds.offsetY.toString());

    maskElement.appendChild(rectElement);

    for (const drill of this.drills) {
      const renderer = RendererProvider.getRenderer(drill);
      renderer.render(drill, maskElement, this._renderContext);
    }

    return (this._layerElement = maskElement);
  }

  apply(layers: [Layer, SVGElement][]): void {
    if (this._renderProperties?.invisible) {
      return;
    }

    //const span = this._layer.span
    const selectedLayers: [Layer, SVGElement][] = layers.filter(
      (x) => x[0].layerFunction !== 'COMPONENT'
    );
    // TODO: Remove as assembly/test files will not contain more that TOP or BOTTOM layers.
    /*if (span){
            const fromIndex = layers.findIndex(x => x[0].name == span.fromLayer);
            const toIndex = layers.findIndex(x => x[0].name == span.toLayer);
            selectedLayers = layers.slice(fromIndex, toIndex + 1);
        }*/

    for (const selectedLayer of selectedLayers) {
      const drilledLayerElement: SVGElement = document.createElementNS(
        'http://www.w3.org/2000/svg',
        'g'
      );
      drilledLayerElement.innerHTML = selectedLayer[1].innerHTML;
      selectedLayer[1].replaceChildren(drilledLayerElement);

      drilledLayerElement.setAttribute(
        'mask',
        `url(#${this._layerElement.getAttribute('id')})`
      );
    }
  }
}
