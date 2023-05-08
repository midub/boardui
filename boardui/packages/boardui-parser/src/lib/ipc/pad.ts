import { XForm } from './x-form';
import { PinRef } from './pin-ref';
import { StandardPrimitiveGroup } from './standard-primitive-group';
import { Location } from './location';

export class Pad {
  padstackDefRef: string | null = null;
  xform: XForm | null = null;
  location: Location = null!;
  feature: StandardPrimitiveGroup = null!;
  pinRefs: PinRef[] = [];
}
