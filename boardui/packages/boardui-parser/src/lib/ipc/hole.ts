import { HoleType } from './hole-type';
import { platingStatus } from './plating-status';

export class Hole {
  name: string = null!;
  type: HoleType = 'CIRCLE';
  diameter: number = null!;
  platingStatus: platingStatus = null!;
  plusTol: number = null!;
  minusTol: number = null!;
  x: number = null!;
  y: number = null!;
  // TODO: Add specification reference.
}
