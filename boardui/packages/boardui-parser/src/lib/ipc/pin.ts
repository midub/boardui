import { StandardPrimitiveRef } from './standard-primitive-ref';
import { Location } from './location';
import { XForm } from './x-form';

export class Pin {
  location: Location = null!;
  xform: XForm | null = null;
  standardPrimitiveRef: StandardPrimitiveRef = null!;
}
