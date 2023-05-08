import { FillDescGroup } from './fill-desc-group';
import { PolyBegin } from './poly-begin';
import { PolyStepCurve } from './poly-step-curve';
import { PolyStepSegment } from './poly-step-segment';
import { XForm } from './x-form';

export class Polygon {
  polyBegin: PolyBegin = null!;
  polySteps: (PolyStepSegment | PolyStepCurve)[] = [];
  fillDesc: FillDescGroup | null = null;
  xform: XForm | null = null;
}
