import { FillDescGroup } from './fill-desc-group';
import { LineDescGroup } from './line-desc-group';
import { XForm } from './x-form';

export class Oval {
  width: number = null!;
  height: number = null!;
  lineDesc: LineDescGroup | null = null;
  fillDesc: FillDescGroup | null = null;
  xform: XForm | null = null;
}
