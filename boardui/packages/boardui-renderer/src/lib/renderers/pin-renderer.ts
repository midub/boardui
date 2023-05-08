import { RendererBase } from './renderer-base';
import { ElementType } from '../element-type';
import { ElementIdProvider } from '../element-id-provider';
import { RenderProperties } from 'boardui-core';
import { Pin } from 'boardui-parser';
import { ReusablesProvider } from '../reusables-provider';

export class PinRenderer extends RendererBase<Pin> {
  private _cloneablePinAttribute = document.createAttribute(ElementType.PIN);
  constructor() {
    super('g');
  }

  protected renderPart(
    part: Pin,
    partElement: SVGElement,
    reusablesProvider: ReusablesProvider,
    elementIdProvider: ElementIdProvider,
    renderProperties: RenderProperties,
    renderSubpart: (part: any, partElement: SVGElement) => void
  ): void {
    partElement.setAttributeNode(
      this._cloneablePinAttribute.cloneNode() as Attr
    );
    partElement.setAttribute(
      'id',
      elementIdProvider.getElementId(part).toString()
    );

    const transformation = [`translate(${part.location.x},${part.location.y})`];
    if (part.xform) transformation.push(part.xform.getSVGTransformation());

    partElement.setAttribute('transform', transformation.join(' '));

    const standardPrimitive = reusablesProvider.getPrimitiveById(
      part.standardPrimitiveRef.id
    );
    renderSubpart(standardPrimitive, partElement);
  }
}
