import { OvalRenderer } from '../src/lib/renderers/oval-renderer';
import { FillDesc, LineDesc, Oval } from '../../boardui-parser/src';
import { ReusablesProviderMock } from './reusables-provider.mock';
import { ElementIdProviderMock } from './element-id-provider.mock';
import { RendererProvider } from '../src/lib/renderer-provider';
import { RenderPropertiesMock } from './render-properties.mock';
import '@testing-library/jest-dom';

let ovalRenderer: OvalRenderer;
let targetElement: SVGElement;
let testFillDesc: FillDesc = new FillDesc();
let testLineDesc: LineDesc = {
  lineEnd: 'ROUND',
  lineWidth: '1',
  lineProperty: 'SOLID',
};

function render(oval: Oval): SVGElement {
  ovalRenderer.render(oval, targetElement, {
    reusablesProvider: ReusablesProviderMock,
    elementIdProvider: ElementIdProviderMock,
    renderProperties: RenderPropertiesMock,
    getRenderer: RendererProvider.getRenderer,
  });

  return targetElement.childNodes[0] as SVGElement;
}

beforeEach(() => {
  ovalRenderer = new OvalRenderer();
  targetElement = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  testFillDesc.color = {
    r: 1,
    g: 2,
    b: 3,
  };
});

describe('OvalRenderer render test', () => {
  it('should render basic oval', async () => {
    const oval: Oval = {
      width: 2,
      height: 4,
      lineDesc: null,
      fillDesc: null,
      xform: null,
    };

    const result = render(oval);

    expect(result.tagName).toBe('rect');
    expect(result).toHaveAttribute('x', '-1');
    expect(result).toHaveAttribute('width', '2');
    expect(result).toHaveAttribute('y', '-2');
    expect(result).toHaveAttribute('height', '4');
    expect(result).toHaveAttribute('ry', '2');
  });

  it('should render oval with fill', async () => {
    const oval: Oval = {
      width: 2,
      height: 4,
      lineDesc: null,
      fillDesc: testFillDesc,
      xform: null,
    };

    const result = render(oval);

    expect(result).toHaveAttribute('fill', 'rgb(1,2,3)');
  });

  it('should render oval with stroke', async () => {
    const oval: Oval = {
      width: 2,
      height: 4,
      lineDesc: testLineDesc,
      fillDesc: null,
      xform: null,
    };

    const result = render(oval);

    expect(result).toHaveAttribute('stroke-width', '1');
    expect(result).toHaveAttribute('stroke-linecap', 'round');
  });
});
