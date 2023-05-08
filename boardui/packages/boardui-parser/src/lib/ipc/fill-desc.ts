import { ColorGroup } from './color-group';
import { FillProperty } from './fill-property';

export class FillDesc {
  fillProperty: FillProperty = null!;
  lineWidth: number | null = null;
  pitch1: number | null = null;
  pitch2: number | null = null;
  angle1: number | null = null;
  angle2: number | null = null;
  color: ColorGroup | null = null;
}
