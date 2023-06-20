import { SAXParser } from 'sax-wasm';
import { IPC2581 } from './ipc/ipc2581';
import { XMLtoJSMapping } from './xml-to-js-mapping';
import { DEFAULT_IPC_MAPPINGS } from './default-ipc-mappings';
import { XmlToJsParser } from './xml-to-js-parser';

export class IPC2581Parser extends XmlToJsParser<IPC2581> {
  constructor(saxParser: SAXParser, mappings?: XMLtoJSMapping[]) {
    super(
      mappings ? mappings : DEFAULT_IPC_MAPPINGS,
      IPC2581.prototype,
      saxParser
    );
  }
}
