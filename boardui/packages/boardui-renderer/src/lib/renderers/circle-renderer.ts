import { Circle, FillDescRef, LineDescRef } from 'boardui-parser';
import '../extensions/fill-desc.extensions';
import { RendererBase } from './renderer-base';
import { ReusablesProvider } from '../reusables-provider';
import { getFillDescSVGAttributes } from '../extensions/fill-desc.extensions';
import { getLineDescSVGAttributes } from '../extensions/line-desc.extensions';

export class CircleRenderer extends RendererBase<Circle> {
  constructor() {
    super('circle');
  }

  protected renderPart(
    part: Circle,
    partElement: SVGElement,
    reusablesProvider: ReusablesProvider
  ): void {
    partElement.setAttribute('r', (part.diameter / 2).toString());

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
