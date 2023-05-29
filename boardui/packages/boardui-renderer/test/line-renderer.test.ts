import { FillDesc, Line, LineDesc } from '../../boardui-parser/src';
import { ReusablesProviderMock } from './reusables-provider.mock';
import { ElementIdProviderMock } from './element-id-provider.mock';
import { RendererProvider } from '../src/lib/renderer-provider';
import { RenderPropertiesMock } from './render-properties.mock';
import '@testing-library/jest-dom';
import { LineRenderer } from '../src/lib/renderers';

let lineRenderer: LineRenderer;
let targetElement: SVGElement;
let testFillDesc: FillDesc = new FillDesc();
let testLineDesc: LineDesc = {
  lineEnd: 'ROUND',
  lineWidth: '1',
  lineProperty: 'SOLID',
};

function render(line: Line): SVGElement {
  lineRenderer.render(line, targetElement, {
    reusablesProvider: ReusablesProviderMock,
    elementIdProvider: ElementIdProviderMock,
    renderProperties: RenderPropertiesMock,
    getRenderer: RendererProvider.getRenderer,
  });

  return targetElement.childNodes[0] as SVGElement;
}

beforeEach(() => {
  lineRenderer = new LineRenderer();
  targetElement = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  testFillDesc.color = {
    r: 1,
    g: 2,
    b: 3,
  };
});

describe('LineRenderer render test', () => {
  it('should render basic line', async () => {
    const line: Line = {
        startX: -1,
        startY: -2,
        endX: 1,
        endY: 2,
      lineDesc: testLineDesc
    };

    const result = render(line);

    expect(result.tagName).toBe('line');
    expect(result).toHaveAttribute('x1', '-1');
    expect(result).toHaveAttribute('x2', '1');
    expect(result).toHaveAttribute('y1', '-2');
    expect(result).toHaveAttribute('y2', '2');
    expect(result).toHaveAttribute('stroke-width', '1');
    expect(result).toHaveAttribute('stroke-linecap', 'round');
  });
});
