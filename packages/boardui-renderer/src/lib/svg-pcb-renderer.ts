import { DrillLayer } from './layers/drill-layer';
import { RendererProvider } from './renderer-provider';
import { ConductorLayer } from './layers/conductor-layer';
import { IPC2581, Layer, Side } from 'boardui-parser';
import { RenderContext } from './render-context';
import { SilkscreenLayer } from './layers/silkscreen-layer';
import { ComponentLayer } from './layers/component-layer';
import { ProfileLayer } from './layers/profile-layer';
import { ElementType } from './element-type';
import { RenderProperties } from 'boardui-core';
import { ElementIdProvider } from './element-id-provider';
import { getPolygonBounds } from './extensions/polygon.extensions';
import { ReusablesProvider } from './reusables-provider';

export class SVGPCBRenderer {
  private _cloneableSvgElement: SVGElement;

  constructor(
    private _reusablesProvider: ReusablesProvider,
    private _renderProperties: RenderProperties
  ) {
    this._cloneableSvgElement = document.createElementNS(
      'http://www.w3.org/2000/svg',
      'svg'
    );
    this._cloneableSvgElement.setAttribute(
      'xmlns',
      'http://www.w3.org/2000/svg'
    );
  }

  render(
    pcb: IPC2581,
    stepName: string,
    side: Side,
    elementIdProvider: ElementIdProvider
  ): SVGElement {
    const step = pcb.ecad.cadData.steps.find((x) => x.name === stepName);
    if (!step) {
      throw new Error('Step not found');
    }

    const renderContext = new RenderContext(
      this._reusablesProvider,
      elementIdProvider,
      this._renderProperties,
      RendererProvider.getRenderer
    );

    const svgElement: SVGElement =
      this._cloneableSvgElement.cloneNode() as SVGElement;
    svgElement.setAttribute(ElementType.STEP, step.name);
    //svgElement.setAttribute("id", renderContext.elementIdProvider.getElementId(step).toString());
    const defsElement = document.createElementNS(
      'http://www.w3.org/2000/svg',
      'defs'
    );

    if (side === 'TOP') {
      svgElement.setAttribute('transform', 'scale(-1,1) rotate(180)');
    } else {
      svgElement.setAttribute('transform', 'scale(1,1) rotate(180)');
    }

    const bounds = getPolygonBounds(
      pcb.ecad.cadData.steps[0]!.profile!.polygon
    );
    svgElement.setAttribute(
      'viewBox',
      `${bounds.offsetX - this._renderProperties.padding} ${
        bounds.offsetY - this._renderProperties.padding
      } ${bounds.width + this._renderProperties.padding * 2} ${
        bounds.height + this._renderProperties.padding * 2
      }`
    );

    const profileLayer = new Layer();
    profileLayer.name = 'PROFILE';
    const profileLayerElement = new ProfileLayer(
      profileLayer,
      step,
      renderContext
    ).render();

    if (this._renderProperties.dropShadow) {
      const filterElement = document.createElementNS(
        'http://www.w3.org/2000/svg',
        'filter'
      );
      filterElement.setAttribute('id', 'board-shadow');
      const dropShadowElement = document.createElementNS(
        'http://www.w3.org/2000/svg',
        'feDropShadow'
      );
      dropShadowElement.setAttribute(
        'dx',
        this._renderProperties.dropShadow.dx.toString()
      );
      dropShadowElement.setAttribute(
        'dy',
        this._renderProperties.dropShadow.dy.toString()
      );
      dropShadowElement.setAttribute(
        'stdDeviation',
        this._renderProperties.dropShadow.stdDeviation.toString()
      );
      filterElement.appendChild(dropShadowElement);
      defsElement.appendChild(filterElement);
      profileLayerElement.setAttribute('filter', 'url(#board-shadow)');
    }
    svgElement.appendChild(defsElement);

    const layers = pcb.content.layerRefs
      .map((x) => x.name)
      .map((x) => renderContext.reusablesProvider.getLayerByName(x))
      .filter(
        (layer) => layer.side === side || layer.layerFunction === 'DRILL'
      );
    const conductorLayers = layers.filter(
      (layer) => layer.layerFunction === 'CONDUCTOR'
    );
    const componentLayers = conductorLayers.map((conductorLayer) => {
      const componentLayer = new Layer();
      componentLayer.name = `${conductorLayer.name}`;
      componentLayer.layerFunction = 'COMPONENT';
      return componentLayer;
    });
    const drillLayers = layers.filter(
      (layer) => layer.layerFunction === 'DRILL'
    );
    const silkscreenLayers = layers.filter(
      (layer) => layer.layerFunction === 'SILKSCREEN'
    );
    console.table([
      { layerType: 'CONDUCTOR', count: conductorLayers.length },
      { layerType: 'DRILL', count: drillLayers.length },
      { layerType: 'SILKSCREEN', count: silkscreenLayers.length },
      { layerType: 'COMPONENT', count: silkscreenLayers.length },
    ]);

    const conductorLayerElements = conductorLayers
      .map(
        (layer) =>
          new ConductorLayer(
            layer,
            step,
            renderContext,
            step.layerFeatures.find((x) => x.layerRef === layer.name)!
          )
      )
      .map<[Layer, SVGElement]>((x) => [x.layer, x.render()]);

    const componentLayerElements = componentLayers
      .map((layer) => new ComponentLayer(layer, step, renderContext))
      .map<[Layer, SVGElement]>((x) => [x.layer, x.render()]);

    const drillLayerElements = drillLayers
      .map(
        (layer) =>
          new DrillLayer(
            layer,
            step,
            renderContext,
            step.layerFeatures.find((x) => x.layerRef === layer.name)!,
            bounds
          )
      )
      .map<[Layer, SVGElement, DrillLayer]>((x) => [x.layer, x.render(), x]);

    const silkscreenLayerElements = silkscreenLayers
      .map(
        (layer) =>
          new SilkscreenLayer(
            layer,
            step,
            renderContext,
            step.layerFeatures.find((x) => x.layerRef === layer.name)!
          )
      )
      .map<[Layer, SVGElement]>((x) => [x.layer, x.render()]);

    for (const drillLayer of drillLayerElements.map((x) => x[2])) {
      drillLayer.apply([
        [profileLayer, profileLayerElement],
        ...conductorLayerElements,
        ...componentLayerElements,
        ...silkscreenLayerElements,
      ]);
    }

    svgElement.append(
      profileLayerElement,
      ...conductorLayerElements.map((x) => x[1]),
      ...drillLayerElements.map((x) => x[1]),
      ...silkscreenLayerElements.map((x) => x[1]),
      ...componentLayerElements.map((x) => x[1])
    );

    return svgElement;
  }
}
