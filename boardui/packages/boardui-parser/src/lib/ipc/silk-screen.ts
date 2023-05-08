import { Marking } from './marking';
import { MarkingUsage } from './marking-usage';
import { Outline } from './outline';
import { Location } from './location';
import { XForm } from './x-form';
import { StandardPrimitiveGroup } from './standard-primitive-group';

export class SilkScreen {
  outline: Outline[] = [];
  marking: Marking[] = [];
  markingUsage: MarkingUsage = null!;
  xform: XForm | null = null;
  location: Location = null!;
  features: StandardPrimitiveGroup[] = [];
}
