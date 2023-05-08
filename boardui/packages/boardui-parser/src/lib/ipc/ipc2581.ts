import { Bom } from './bom';
import { Content } from './content';
import { Ecad } from './ecad';

export class IPC2581 {
  revision: string = null!;
  content: Content = null!;
  ecad: Ecad = null!;
  bom: Bom = null!;
}
