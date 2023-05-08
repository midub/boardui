import { RendererBase } from './renderer-base';
import { ElementType } from '../element-type';
import { Pad, StandardPrimitiveRef } from 'boardui-parser';
import { ElementIdProvider } from '../element-id-provider';
import { RenderProperties } from 'boardui-core';
import { ReusablesProvider } from '../reusables-provider';

export class PadRenderer extends RendererBase<Pad> {
  private _cloneablePinAttribute = document.createAttribute(ElementType.PAD);
  constructor() {
    super('g');
  }

  protected renderPart(
    part: Pad,
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
    if (part.xform) {
      transformation.push(part.xform.getSVGTransformation());
    }

    partElement.setAttribute('transform', transformation.join(' '));

    const standardPrimitive =
      part.feature instanceof StandardPrimitiveRef
        ? reusablesProvider.getPrimitiveById(part.feature.id)
        : part.feature;
    if (!standardPrimitive) {
      throw new Error(`Pad ${part.padstackDefRef} has no graphic.`);
    }
    renderSubpart(standardPrimitive, partElement);
  }
}
