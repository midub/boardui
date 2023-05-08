import { Layer, Step } from 'boardui-parser';
import { LayerType, LayerTypeRenderProperties } from 'boardui-core';
import { RenderContext } from '../render-context';

export abstract class LayerBase {
  protected _layerElement!: SVGElement;
  protected _renderProperties: LayerTypeRenderProperties | null = null;

  protected get name(): string {
    return this._layer.name;
  }

  public get layer(): Layer {
    return this._layer;
  }

  constructor(
    protected _layer: Layer,
    protected _step: Step,
    protected _renderContext: RenderContext,
    protected _layerType: LayerType
  ) {
    this._renderProperties =
      this._renderContext.renderProperties.layerTypesRenderProperties.find(
        (layerTypeRenderProperty) =>
          layerTypeRenderProperty.layerType === _layerType
      ) ?? null;
  }

  abstract render(): SVGElement;
}
