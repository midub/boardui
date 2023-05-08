import { ElementIdProvider } from './element-id-provider';

export class ElementMap implements ElementIdProvider {
  private _elementMap: Map<number, any> = new Map();
  private _lastId = 0;

  /** Adds element to map and returns its identifier. */
  addElement(element: any): number {
    const newId = ++this._lastId;
    this._elementMap.set(newId, element);
    return newId;
  }

  /** Gets element by its identifier. */
  getElement(id: number): any | null {
    return this._elementMap.get(id);
  }

  getElementId(element: any): number {
    return this.addElement(element);
  }
}
