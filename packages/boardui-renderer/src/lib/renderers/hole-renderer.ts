import { Hole } from 'boardui-parser';
import { RendererBase } from './renderer-base';

export class HoleRenderer extends RendererBase<Hole> {
  constructor() {
    super('g');
  }

  protected renderPart(part: Hole, partElement: SVGElement): void {
    if (part.type === 'CIRCLE') {
      partElement.setAttribute('r', (part.diameter / 2).toString());
      partElement.setAttribute('cx', part.x.toString());
      partElement.setAttribute('cy', part.y.toString());
      partElement.setAttribute('fill', 'black');
    }
  }

  private _cloneableCirclePartElement = document.createElementNS(
    'http://www.w3.org/2000/svg',
    'circle'
  );
  private _cloneableRectPartElement = document.createElementNS(
    'http://www.w3.org/2000/svg',
    'rect'
  );
  protected override getPartElement(part: Hole): SVGElement {
    if (part.type === 'CIRCLE') {
      return this._cloneableCirclePartElement.cloneNode() as SVGElement;
    } else if (part.type === 'SQUARE') {
      return this._cloneableRectPartElement.cloneNode() as SVGElement;
    } else {
      throw new Error('Not supported.');
    }
  }
}
