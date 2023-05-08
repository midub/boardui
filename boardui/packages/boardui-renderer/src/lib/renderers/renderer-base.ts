import { RenderProperties } from 'boardui-core';
import { ElementIdProvider } from '../element-id-provider';
import { RenderContext } from '../render-context';
import { Renderer } from '../renderer';
import { ReusablesProvider } from '../reusables-provider';

export abstract class RendererBase<T> implements Renderer<T> {
  private _cloneablePartElement = document.createElementNS(
    'http://www.w3.org/2000/svg',
    this._tagName
  );

  protected getPartElement(part: T): SVGElement {
    return this._cloneablePartElement.cloneNode() as SVGElement;
  }

  protected abstract renderPart(
    part: T,
    partElement: SVGElement,
    reusablesProvider: ReusablesProvider,
    elementIdProvider: ElementIdProvider,
    renderProperties: RenderProperties,
    renderSubpart: (part: any, partElement: SVGElement) => void
  ): void;

  constructor(private _tagName: string) {}

  public render(part: T, target: Node, context: RenderContext): void {
    const partElement = this.getPartElement(part);

    this.renderPart(
      part,
      partElement,
      context.reusablesProvider,
      context.elementIdProvider,
      context.renderProperties,
      (part: any, partElement: SVGElement) =>
        context.getRenderer(part).render(part, partElement, context)
    );

    target.appendChild(partElement);
  }
}
