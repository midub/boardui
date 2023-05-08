import { Oval, FillDescRef, LineDescRef } from 'boardui-parser';
import '../extensions/fill-desc.extensions';
import { RendererBase } from './renderer-base';
import { ReusablesProvider } from '../reusables-provider';
import { getFillDescSVGAttributes } from '../extensions/fill-desc.extensions';
import { getLineDescSVGAttributes } from '../extensions/line-desc.extensions';

export class OvalRenderer extends RendererBase<Oval> {
  constructor() {
    super('rect');
  }

  protected renderPart(
    part: Oval,
    partElement: SVGElement,
    reusablesProvider: ReusablesProvider
  ): void {
    partElement.setAttribute('width', part.width.toString());
    partElement.setAttribute('height', part.height.toString());
    partElement.setAttribute('x', (-part.width / 2).toString());
    partElement.setAttribute('y', (-part.height / 2).toString());
    partElement.setAttribute('ry', (part.height / 2).toString());

    if (part.fillDesc) {
      const fillDesc =
        part.fillDesc instanceof FillDescRef
          ? reusablesProvider.getFillDescById(part.fillDesc.id)
          : part.fillDesc;
      const fillDescAttributes = getFillDescSVGAttributes(
        fillDesc,
        reusablesProvider
      );
      for (const fillDescAttribute of fillDescAttributes) {
        partElement.setAttribute(...fillDescAttribute);
      }
    }

    if (part.lineDesc) {
      const lineDesc =
        part.lineDesc instanceof LineDescRef
          ? reusablesProvider.getLineDescById(part.lineDesc.id)
          : part.lineDesc;
      const lineDescAttributes = getLineDescSVGAttributes(lineDesc);
      for (const lineDescAttribute of lineDescAttributes) {
        partElement.setAttribute(...lineDescAttribute);
      }
    } else {
      partElement.setAttribute('stroke-width', '0');
    }
  }
}
