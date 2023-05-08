import { Attribute, SaxEventType, SAXParser, Tag } from 'sax-wasm';
import { XMLtoJSMapping as XMLToJSMapping } from './xml-to-js-mapping';

export class XmlToJsParser<TResult> {
  private static _chunkSize = 64 * 1024;

  private _processOpenTagFuncHashSet: Map<
    string,
    (obj: any, stack: any[]) => any
  >;

  constructor(
    mappings: XMLToJSMapping[],
    private _rootNodePrototype: any,
    private _saxParser: SAXParser
  ) {
    this._processOpenTagFuncHashSet = new Map(
      mappings
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map((x) => XmlToJsParser.getMappingFunc(...x))
    );
  }

  static getMappingFunc(
    tagName: string,
    prototype: any,
    properties: string[]
  ): [string, (obj: any, stack: any[]) => void] {
    return [
      tagName,
      (obj: any, stack: any[]) => {
        for (const property of properties) {
          if (Object.prototype.hasOwnProperty.call(obj, property)) {
            const emptyObj = new prototype.constructor();
            if (Array.isArray(obj[property])) {
              Array.prototype.push.call(obj[property], emptyObj);
            } else if (obj[property]) {
              Array.prototype.push.call(stack, obj[property]);
              return;
            } else {
              obj[property] = emptyObj;
            }
            Array.prototype.push.call(stack, emptyObj);
            return;
          }
        }
        console.debug('Cannot find property for ' + tagName);
      },
    ];
  }

  static processOpenTag(
    tag: Tag,
    stack: any[],
    processOpenTagFuncHashSet: Map<string, (obj: any, stack: any[]) => any>
  ) {
    const obj = stack.at(-1);
    if (!obj) {
      Array.prototype.push.call(stack, null);
      console.debug('Cannot process ' + tag.name);
    } else {
      const mappingFunc = processOpenTagFuncHashSet.get(tag.name);
      if (mappingFunc) {
        try {
          mappingFunc(obj, stack);
        } catch (e) {
          console.log(e);
        }
      } else {
        Array.prototype.push.call(stack, null);
        console.debug('Cannot process ' + tag.name);
      }
    }
  }

  static processAttribute(attribute: Attribute, stack: any[]) {
    const obj = stack.at(-1);
    if (obj) {
      const attributeName = attribute.name.value;
      if (Object.prototype.hasOwnProperty.call(obj, attributeName)) {
        obj[attributeName] = attribute.value.value;
      }
    }
  }

  static processEvent(
    event: SaxEventType,
    data: any,
    stack: any[],
    processOpenTagFuncHashSet: Map<string, (obj: any, stack: any[]) => any>
  ) {
    switch (event) {
      case SaxEventType.OpenTagStart:
        XmlToJsParser.processOpenTag(
          <Tag>data,
          stack,
          processOpenTagFuncHashSet
        );
        break;
      case SaxEventType.Attribute:
        XmlToJsParser.processAttribute(<Attribute>data, stack);
        break;
      case SaxEventType.CloseTag:
        stack.pop();
        break;
    }
  }

  async parse(stream: ReadableStream<Uint8Array>): Promise<TResult> {
    const rootNode = new this._rootNodePrototype.constructor();
    const stack = [rootNode];

    this._saxParser.eventHandler = (event, data) =>
      XmlToJsParser.processEvent(
        event,
        data,
        stack,
        this._processOpenTagFuncHashSet
      );

    const streamReader = stream.getReader();
    let readResult = null;
    while (!(readResult = await streamReader.read()).done) {
      const chunk = readResult.value;
      const chunkSliceCount = Math.floor(
        chunk.length / XmlToJsParser._chunkSize
      );
      let i = 0;
      while (i < chunkSliceCount) {
        this._saxParser.write(
          chunk.subarray(
            i * XmlToJsParser._chunkSize,
            ++i * XmlToJsParser._chunkSize
          )
        );
      }
      this._saxParser.write(
        chunk.subarray(i * XmlToJsParser._chunkSize, chunk.length)
      );
    }
    this._saxParser.end();
    return rootNode;
  }
}
