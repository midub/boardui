import { FillDescGroup } from './fill-desc-group';
import { LineDescGroup } from './line-desc-group';
import { PolyBegin } from './poly-begin';
import { PolyStepCurve } from './poly-step-curve';
import { PolyStepSegment } from './poly-step-segment';

export class Polyline {
  polyBegin: PolyBegin = null!;
  polySteps: (PolyStepSegment | PolyStepCurve)[] = [];
  lineDesc: LineDescGroup | null = null!;
}
