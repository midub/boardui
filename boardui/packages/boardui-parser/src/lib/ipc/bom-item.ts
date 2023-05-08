import { BomCategory } from './bom-category';
import { Characteristics } from './characteristics';
import { RefDes } from './ref-des';

export class BomItem {
  OEMDesignNumberRef: string = null!;
  quantity: string = null!;
  pinCount: string | null = null;
  category: BomCategory = null!;
  refDes: RefDes[] = [];
  characteristics: Characteristics = null!;
}
