import { XMLtoJSMapping } from '../src/lib/xml-to-js-mapping';
import { XmlToJsParser } from '../src/lib/xml-to-js-parser';
import { Attribute, SaxEventType, Tag } from 'sax-wasm';

describe('XMLToJSParser processAttribute method test', () => {
  it('should assign attribute', async () => {
    const stack = [
      {
        child: null,
      },
    ];

    XmlToJsParser.processOpenTag(
      {
        name: 'child',
      } as Tag,
      [],
      new Map(),
    );
    XmlToJsParser.processAttribute(
      { name: { value: 'child' }, value: { value: 'test' } } as Attribute,
      stack,
    );

    expect(stack.at(0)).toEqual({
      child: 'test',
    });
  });
});

const processOpenTagFuncHashSet = new Map(
  [['child', Object.prototype, ['child']] as XMLtoJSMapping].map((x) =>
    XmlToJsParser.getMappingFunc(...x),
  ),
);

describe('XMLToJSParser processOpenTag method test', () => {
  it('should assign child', async () => {
    const stack = [
      {
        child: null,
      },
    ];

    XmlToJsParser.processOpenTag(
      {
        name: 'child',
      } as Tag,
      stack,
      processOpenTagFuncHashSet,
    );

    expect(stack.at(0)).toEqual({
      child: {},
    });
  });
});

describe('XMLToJSParser processCloseTag method test', () => {
  it('should pop item from stack', async () => {
    const stack = [
      {
        child: null,
      },
    ];

    XmlToJsParser.processEvent(
      SaxEventType.CloseTag,
      {
        name: 'child',
      },
      stack,
      processOpenTagFuncHashSet,
    );

    expect(stack.length).toEqual(0);
  });
});
