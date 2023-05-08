import { Contour, FillDescRef } from 'boardui-parser';
import '../extensions/polygon.extensions';
import { RendererBase } from './renderer-base';
import { ReusablesProvider } from '../reusables-provider';
import { getFillDescSVGAttributes } from '../extensions/fill-desc.extensions';
import { getPolygonPath } from '../extensions/polygon.extensions';

export class ContourRenderer extends RendererBase<Contour> {
  constructor() {
    super('path');
  }

  protected renderPart(
    part: Contour,
    partElement: SVGElement,
    reusablesProvider: ReusablesProvider
  ): void {
    const path = getPolygonPath(part.polygon, part.cutouts);
    partElement.setAttribute('d', path);
    partElement.setAttribute('stroke-width', '0');

    if (part.polygon.fillDesc) {
      const fillDesc =
        part.polygon.fillDesc instanceof FillDescRef
          ? reusablesProvider.getFillDescById(part.polygon.fillDesc.id)
          : part.polygon.fillDesc;
      const fillDescAttributes = getFillDescSVGAttributes(
        fillDesc,
        reusablesProvider
      );
      for (const fillDescAttribute of fillDescAttributes) {
        partElement.setAttribute(...fillDescAttribute);
      }
    }
  }
}
