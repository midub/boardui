import { LineDescRef, Line } from 'boardui-parser';
import '../extensions/fill-desc.extensions';
import { RendererBase } from './renderer-base';
import { ReusablesProvider } from '../reusables-provider';
import { getLineDescSVGAttributes } from '../extensions/line-desc.extensions';

export class LineRenderer extends RendererBase<Line> {
  constructor() {
    super('line');
  }

  protected renderPart(
    part: Line,
    partElement: SVGElement,
    reusablesProvider: ReusablesProvider
  ): void {
    partElement.setAttribute('x1', part.startX.toString());
    partElement.setAttribute('x2', part.endX.toString());
    partElement.setAttribute('y1', part.startY.toString());
    partElement.setAttribute('y2', part.endY.toString());

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
