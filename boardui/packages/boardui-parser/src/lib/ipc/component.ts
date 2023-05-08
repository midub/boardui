import { Location } from './location';
import { Mount } from './mount';
import { NonstandardAttribute } from './nonstandard-attribute';
import { XForm } from './x-form';

export class Component {
  refDes: string | null = null;
  matDes: string | null = null;
  packageRef: string | null = null;
  part: string = null!;
  layerRef: string = null!;
  layerRefTopside: string | null = null;
  mountType: Mount = null!;
  modelRef: string | null = null;
  weight: number | null = null!;
  height: number | null = null!;
  standoff: number | null = null!;
  location: Location = null!;
  xform: XForm | null = null;
  nonstandardAttributes: NonstandardAttribute[] = [];
  // TODO: More properties, IDK if usable :)
}
