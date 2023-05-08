import { BomHeader } from './bom-header';
import { BomItem } from './bom-item';

export class Bom {
  name: string = null!;
  bomHeader: BomHeader = null!;
  bomItems: BomItem[] = [];
}
