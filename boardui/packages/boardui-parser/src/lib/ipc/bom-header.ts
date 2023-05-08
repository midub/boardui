import { StepRef } from './step-ref';

export class BomHeader {
  assembly: string = null!;
  revision: string = null!;
  affecting: string | null = null;
  stepRefs: StepRef[] = [];
}
