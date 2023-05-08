import { LayerType } from './layer-type';
import { Side } from './side';

/** PCB layer. */
export interface Layer {
  /** Layer name. */
  name: string;

  /** Layer type. */
  type: LayerType;

  /** Side on which is layer located. */
  side: Side;
}
