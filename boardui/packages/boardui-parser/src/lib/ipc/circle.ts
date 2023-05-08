import { FillDescGroup } from './fill-desc-group';
import { LineDescGroup } from './line-desc-group';
import { XForm } from './x-form';

export class Circle {
  diameter: number = null!;
  lineDesc: LineDescGroup | null = null;
  fillDesc: FillDescGroup | null = null;
  xform: XForm | null = null;
}
