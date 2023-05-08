import { StandardPrimitive } from './standard-primitive';

export class Marking {
  location: Location | null = null;
  markingUsage: string = null!;
  features: StandardPrimitive[] = [];
}
