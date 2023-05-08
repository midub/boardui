import {
  Layer,
  Color,
  LineDesc,
  FillDesc,
  StandardPrimitive,
  Package,
  IPC2581,
  Step,
  DictionaryEntry,
} from 'boardui-parser';
import './extensions/line-desc.extensions';
import { ReusablesProvider } from './reusables-provider';

export class ReusablesRepository implements ReusablesProvider {
  private readonly _layers: Map<string, Layer>;
  private readonly _colors: Map<string, Color>;
  private readonly _lineDescs: Map<string, LineDesc>;
  private readonly _fillDescs: Map<string, FillDesc>;
  private readonly _primitives: Map<string, StandardPrimitive>;
  private readonly _packages: Map<string, Package>;

  constructor(_ipc: IPC2581) {
    this._layers = new Map(
      _ipc.ecad.cadData.layers.map((layer) => [layer.name, layer])
    );
    this._colors = new Map(
      _ipc.content.dictionaryColor.entries.map(
        (colorEntry: DictionaryEntry<Color>) => [
          colorEntry.id,
          colorEntry.content,
        ]
      )
    );
    this._lineDescs = new Map(
      _ipc.content.dictionaryLineDesc.entries.map(
        (lineDescEntry: DictionaryEntry<LineDesc>) => [
          lineDescEntry.id,
          lineDescEntry.content,
        ]
      )
    );
    this._fillDescs = new Map(
      _ipc.content.dictionaryFillDesc.entries.map(
        (fillDescEntry: DictionaryEntry<FillDesc>) => [
          fillDescEntry.id,
          fillDescEntry.content,
        ]
      )
    );
    this._primitives = new Map(
      _ipc.content.dictionaryStandard.entries.map(
        (primitiveEntry: DictionaryEntry<StandardPrimitive>) => [
          primitiveEntry.id,
          primitiveEntry.content,
        ]
      )
    );
    this._packages = new Map(
      _ipc.ecad.cadData.steps.flatMap((step: Step) =>
        step.packages.map((p: Package) => [p.name, p])
      )
    );
  }

  public getLayerByName(name: string): Layer {
    const layer = this._layers.get(name);
    if (!layer) {
      throw new Error(`Layer '${name}' not found.`);
    }
    return layer;
  }

  public getColorById(colorId: string): Color {
    const color = this._colors.get(colorId);
    if (!color) {
      throw new Error(`Color '${colorId}' not found.`);
    }
    return color;
  }

  public getLineDescById(lineDescId: string): LineDesc {
    const lineDesc = this._lineDescs.get(lineDescId);
    if (!lineDesc) {
      throw new Error(`Line descriptor '${lineDescId}' not found.`);
    }
    return lineDesc;
  }

  public getFillDescById(fillDescId: string): FillDesc {
    const fillDesc = this._fillDescs.get(fillDescId);
    if (!fillDesc) {
      throw new Error(`Fill descriptor '${fillDescId}' not found.`);
    }
    return fillDesc;
  }

  public getPrimitiveById(primitiveId: string): StandardPrimitive {
    const primitive = this._primitives.get(primitiveId);
    if (!primitive) {
      throw new Error(`Primitive '${primitiveId}' not found.`);
    }
    return primitive;
  }

  public getPackageByName(name: string): Package {
    const pckg = this._packages.get(name);
    if (!pckg) {
      throw new Error(`Package '${name}' not found.`);
    }
    return pckg;
  }
}
