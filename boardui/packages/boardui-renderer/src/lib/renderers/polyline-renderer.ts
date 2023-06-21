import { Polyline, LineDescRef, LineDesc } from 'boardui-parser';
import { RendererBase } from './renderer-base';
import { ReusablesProvider } from '../reusables-provider';
import { getLineDescSVGAttributes } from '../extensions/line-desc.extensions';
import { getPolygonPath } from '../extensions/polygon.extensions';

export class PolylineRenderer extends RendererBase<Polyline> {
  constructor() {
    super('path');
  }

  protected renderPart(
    part: Polyline,
    partElement: SVGElement,
    reusablesProvider: ReusablesProvider
  ): void {
    partElement.setAttribute('d', getPolygonPath(part, []));

    if (part.lineDesc) {
      const lineDesc =
        part.lineDesc instanceof LineDescRef
          ? reusablesProvider.getLineDescById(part.lineDesc.id)
          : (part.lineDesc as LineDesc);

      for (const lineDescAttribute of getLineDescSVGAttributes(lineDesc)) {
        partElement.setAttribute(...lineDescAttribute);
      }
    }

    partElement.setAttribute('fill', 'none');
  }
}
