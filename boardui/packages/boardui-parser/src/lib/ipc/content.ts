import { BomRef } from './bom-ref';
import { Color } from './color';
import { Dictionary } from './dictionary';
import { FillDesc } from './fill-desc';
import { FunctionMode } from './function-mode';
import { LayerRef } from './layer-ref';
import { LineDesc } from './line-desc';
import { StandardPrimitive } from './standard-primitive';
import { StepRef } from './step-ref';

export class Content {
  functionMode: FunctionMode = null!;
  roleRef: string = null!;
  stepRefs: StepRef[] = [];
  layerRefs: LayerRef[] = [];
  bomRefs: BomRef[] = [];

  dictionaryColor: Dictionary<Color> = null!;
  dictionaryLineDesc: Dictionary<LineDesc> = null!;
  dictionaryFillDesc: Dictionary<FillDesc> = null!;
  dictionaryStandard: Dictionary<StandardPrimitive> = null!;
}
