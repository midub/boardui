import { SaxEventType, SAXParser } from 'sax-wasm';

export async function createSAXParser(saxWasmUrl: string): Promise<SAXParser> {
  const saxWasmResponse = await fetch(saxWasmUrl);
  const saxWasmbuffer = await saxWasmResponse.arrayBuffer();
  const parser = new SAXParser(
    SaxEventType.Attribute | SaxEventType.OpenTagStart | SaxEventType.CloseTag,
  );

  const ready = parser.prepareWasm(new Uint8Array(saxWasmbuffer));
  if (ready) {
    return await ready.then(() => parser);
  } else throw new Error('Cannot initialize sax-wasm.');
}
