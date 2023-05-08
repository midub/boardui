import {
  Contour,
  FillDesc,
  LineDesc,
  PolyStepSegment,
} from 'boardui-parser';
import { ReusablesProviderMock } from './reusables-provider.mock';
import { ElementIdProviderMock } from './element-id-provider.mock';
import { RendererProvider } from '../src/lib/renderer-provider';
import { RenderPropertiesMock } from './render-properties.mock';
import '@testing-library/jest-dom';
import { ContourRenderer } from '../src/lib/renderers';

let contourRenderer: ContourRenderer;
let targetElement: SVGElement;
let testFillDesc: FillDesc = new FillDesc();

function render(contour: Contour): SVGElement {
  contourRenderer.render(contour, targetElement, {
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
  contourRenderer = new ContourRenderer();
  targetElement = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  testFillDesc.color = {
    r: 1,
    g: 2,
    b: 3,
  };
});

describe('ContourRenderer render test', () => {
  it('should render basic contour', async () => {
    const contour: Contour = {
      polygon: {
        polyBegin: {
          x: 10,
          y: 15,
        },
        polySteps: [pathSegment(20, 25), pathSegment(15, 20)],
        fillDesc: null,
        xform: null,
      },
      cutouts: [],
    };

    const result = render(contour);

    expect(result.tagName).toBe('path');
    expect(result).toHaveAttribute('d', 'M 10 15 L 20 25 L 15 20');
  });

  it('should render contour with fill', async () => {
    const contour: Contour = {
      polygon: {
        polyBegin: {
          x: 10,
          y: 15,
        },
        polySteps: [pathSegment(20, 25), pathSegment(15, 20)],
        fillDesc: testFillDesc,
        xform: null,
      },
      cutouts: [],
    };

    const result = render(contour);

    expect(result).toHaveAttribute('fill', 'rgb(1,2,3)');
  });
});
