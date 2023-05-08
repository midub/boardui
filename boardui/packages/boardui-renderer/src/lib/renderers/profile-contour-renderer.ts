import { Contour } from 'boardui-parser';
import '../extensions/polygon.extensions';
import { RendererBase } from './renderer-base';
import { getPolygonPath } from '../extensions/polygon.extensions';

export class ProfileContourRenderer extends RendererBase<Contour> {
  constructor() {
    super('path');
  }

  protected renderPart(part: Contour, partElement: SVGElement): void {
    const path = getPolygonPath(part.polygon, part.cutouts);
    partElement.setAttribute('d', path);
    partElement.setAttribute('stroke-width', '0');
  }
}
