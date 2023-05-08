import { AssemblyDrawing } from './assembly-drawing';
import { Outline } from './outline';
import { Pin } from './pin';
import { PinOneOrientation } from './pin-one-orientation';
import { SilkScreen } from './silk-screen';

export class Package {
  name: string = null!;
  type: string = null!;
  pinOne: string = null!;
  pinOneOrientation: PinOneOrientation = null!;
  height: number = null!;
  outline: Outline = null!;
  pins: Pin[] = [];
  assemblyDrawing: AssemblyDrawing = null!;
  silkScreen: SilkScreen | null = null;
}
