import { CircleRenderer } from '../src/lib/renderers/circle-renderer';
import { Circle, FillDesc, LineDesc } from 'boardui-parser';
import { ReusablesProviderMock } from './reusables-provider.mock';
import { ElementIdProviderMock } from './element-id-provider.mock';
import { RendererProvider } from '../src/lib/renderer-provider';
import { RenderPropertiesMock } from './render-properties.mock';
import '@testing-library/jest-dom';

let circleRenderer: CircleRenderer;
let targetElement: SVGElement;
let testFillDesc: FillDesc = new FillDesc();
let testLineDesc: LineDesc = {
  lineEnd: 'ROUND',
  lineWidth: '1',
  lineProperty: 'SOLID',
};

function render(circle: Circle): SVGElement {
  circleRenderer.render(circle, targetElement, {
    reusablesProvider: ReusablesProviderMock,
    elementIdProvider: ElementIdProviderMock,
    renderProperties: RenderPropertiesMock,
    getRenderer: RendererProvider.getRenderer,
  });

  return targetElement.childNodes[0] as SVGElement;
}

beforeEach(() => {
  circleRenderer = new CircleRenderer();
  targetElement = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  testFillDesc.color = {
    r: 1,
    g: 2,
    b: 3,
  };
});

describe('CircleRenderer render test', () => {
  it('should render basic circle', async () => {
    const circle: Circle = {
      diameter: 2,
      lineDesc: null,
      fillDesc: null,
      xform: null,
    };

    const result = render(circle);

    expect(result.tagName).toBe('circle');
    expect(result).toHaveAttribute('r', '1');
  });

  it('should render circle with fill', async () => {
    const circle: Circle = {
      diameter: 2,
      lineDesc: null,
      fillDesc: testFillDesc,
      xform: null,
    };

    const result = render(circle);

    expect(result).toHaveAttribute('fill', 'rgb(1,2,3)');
  });

  it('should render circle with stroke', async () => {
    const circle: Circle = {
      diameter: 2,
      lineDesc: testLineDesc,
      fillDesc: null,
      xform: null,
    };

    const result = render(circle);

    expect(result).toHaveAttribute('stroke-width', '1');
    expect(result).toHaveAttribute('stroke-linecap', 'round');
  });
});
