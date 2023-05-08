import {
  Component,
  Contour,
  FillDesc,
  LineDesc,
  PolyStepSegment,
} from '../../boardui-parser/src';
import { ReusablesProviderMock } from './reusables-provider.mock';
import { ElementIdProviderMock } from './element-id-provider.mock';
import { RendererProvider } from '../src/lib/renderer-provider';
import { RenderPropertiesMock } from './render-properties.mock';
import '@testing-library/jest-dom';
import { ComponentRenderer, ContourRenderer } from '../src/lib/renderers';

let componentRenderer: ComponentRenderer;
let targetElement: SVGElement;
let testFillDesc: FillDesc = new FillDesc();

function render(component: Component): SVGElement {
  componentRenderer.render(component, targetElement, {
    reusablesProvider: ReusablesProviderMock,
    elementIdProvider: ElementIdProviderMock,
    renderProperties: RenderPropertiesMock,
    getRenderer: RendererProvider.getRenderer,
  });

  return targetElement.childNodes[0] as SVGElement;
}

function pathSegment(x: number, y: number): PolyStepSegment {
  const segment = new PolyStepSegment();
  segment.x = x;
  segment.y = y;

  return segment;
}

beforeEach(() => {
  componentRenderer = new ComponentRenderer();
  targetElement = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  testFillDesc.color = {
    r: 1,
    g: 2,
    b: 3,
  };
});

describe('ComponentRenderer render test', () => {
  it('should render component', async () => {
    const component: Component = {
      refDes: null,
      matDes: null,
      packageRef: 'testPackage',
      part: 'testPart',
      layerRef: 'TOP',
      layerRefTopside: null,
      mountType: 'SMT',
      modelRef: null,
      weight: null,
      height: null,
      standoff: null,
      location: {
        x: 10,
        y: 15,
      },
      xform: null,
      nonstandardAttributes: [],
    };

    const result = render(component);

    expect(result.tagName).toBe('g');
    expect(result).toHaveAttribute('component');

    const outline = Array.from(result.children).find(
      (x) => x.tagName === 'path'
    ) as SVGElement;
    expect(outline).toBeTruthy();
    expect(outline.tagName).toBe('path');
  });
});
