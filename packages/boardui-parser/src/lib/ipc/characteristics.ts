import { BomCategory } from './bom-category';
import { Enumerated } from './enumerated';
import { Measured } from './measured';
import { Ranged } from './ranged';
import { Textual } from './textual';

export class Characteristics {
  category: BomCategory = null!;
  measured: Measured[] = [];
  ranged: Ranged[] = [];
  enumerated: Enumerated[] = [];
  textual: Textual[] = [];
}
