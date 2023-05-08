import { LineEnd } from './line-end';
import { LineProperty } from './line-property';

export class LineDesc {
  lineEnd: LineEnd = null!;
  lineWidth: string = null!;
  lineProperty: LineProperty | null = null!;
}
