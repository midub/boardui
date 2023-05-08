import '../extensions/xform.extensions';
import { RendererBase } from './renderer-base';
import { ElementType } from '../element-type';
import { ColorHelper } from '../color.helper';
import { Component, LineDescRef } from 'boardui-parser';
import { ElementIdProvider } from '../element-id-provider';
import { ComponentRenderProperties, RenderProperties } from 'boardui-core';
import { ReusablesProvider } from '../reusables-provider';
import { getLineDescSVGAttributes } from '../extensions/line-desc.extensions';
import { getPolygonPath } from '../extensions/polygon.extensions';

export class ComponentRenderer extends RendererBase<Component> {
  private _cloneableComponentAttribute = document.createAttribute(
    ElementType.COMPONENT
  );
  constructor() {
    super('g');
  }

  protected renderPart(
    part: Component,
    partElement: SVGElement,
    reusablesProvider: ReusablesProvider,
    elementIdProvider: ElementIdProvider,
    renderProperties: RenderProperties,
    renderSubpart: (part: any, partElement: SVGElement) => void
  ): void {
    partElement.setAttributeNode(
      this._cloneableComponentAttribute.cloneNode() as Attr
    );
    partElement.setAttribute(
      'id',
      elementIdProvider.getElementId(part).toString()
    );

    if (part.refDes) partElement.setAttribute('refDes', part.refDes);
    const transformation = [`translate(${part.location.x},${part.location.y})`];
    if (part.xform) transformation.push(part.xform.getSVGTransformation());

    partElement.setAttribute('transform', transformation.join(' '));

    const componentRenderProperties = this.getComponentRenderProperties(
      renderProperties,
      part
    );

    if (part.packageRef) {
      const pckg = reusablesProvider.getPackageByName(part.packageRef);

      const outlineEle = document.createElementNS(
        'http://www.w3.org/2000/svg',
        'path'
      );
      const lineDesc =
        pckg.outline.lineDesc instanceof LineDescRef
          ? reusablesProvider.getLineDescById(pckg.outline.lineDesc.id)
          : pckg.outline.lineDesc;
      const lineDescAttributes = getLineDescSVGAttributes(lineDesc);
      for (const lineDescAttribute of lineDescAttributes) {
        outlineEle.setAttribute(...lineDescAttribute);
      }
      const path = getPolygonPath(pckg.outline.polygon, []);
      outlineEle.setAttribute('d', path);
      outlineEle.setAttribute('fill', 'rgba(0,0,0,0)');

      if (componentRenderProperties.fillColor) {
        outlineEle.setAttribute(
          'fill',
          ColorHelper.getSVGColor(componentRenderProperties.fillColor)
        );
      }

      if (componentRenderProperties.outlineColor) {
        outlineEle.setAttribute(
          'stroke',
          ColorHelper.getSVGColor(componentRenderProperties.outlineColor)
        );
      }

      for (const pin of pckg.pins) {
        renderSubpart(pin, partElement);
      }

      partElement.appendChild(outlineEle);
    }
  }

  private getComponentRenderProperties(
    renderProperties: RenderProperties,
    component: Component
  ): ComponentRenderProperties {
    let fillColor;
    let outlineColor;
    const renderPropertiesToApply = renderProperties.componentRenderProperties
      .filter((x) =>
        x.selectors.every((selector) => component[selector[0]] === selector[1])
      )
      .sort((a, b) => a.selectors.length - b.selectors.length);
    for (const renderProp of renderPropertiesToApply) {
      if (renderProp.fillColor) {
        fillColor = renderProp.fillColor;
      }
      if (renderProp.outlineColor) {
        outlineColor = renderProp.outlineColor;
      }
    }
    return {
      selectors: [],
      fillColor: fillColor,
      outlineColor: outlineColor,
    };
  }
}
