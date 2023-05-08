import { NonstandardAttribute } from './nonstandard-attribute';
import { Pad } from './pad';
import { ColorGroup } from './color-group';
import { Features } from './features';
import { Hole } from './hole';

export class Set {
  features: Features[] = [];
  colorGroups: ColorGroup[] = [];
  holes: Hole[] = [];
  pads: Pad[] = [];
  nonstandardAttributes: NonstandardAttribute[] = [];
}
