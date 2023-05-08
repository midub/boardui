import { SAXParser } from 'sax-wasm';
import { IPC2581 } from './ipc/ipc2581';
import { XMLtoJSMapping } from './xml-to-js-mapping';
import { DefaultIPCMappings } from './default-ipc-mappings';
import { XmlToJsParser } from './xml-to-js-parser';

export class IPC2581Parser extends XmlToJsParser<IPC2581> {
  constructor(saxParser: SAXParser, mappings?: XMLtoJSMapping[]) {
    super(
      mappings ? mappings : DefaultIPCMappings,
      IPC2581.prototype,
      saxParser
    );
  }
}
