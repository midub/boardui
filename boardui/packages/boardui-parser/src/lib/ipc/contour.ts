import { Polygon } from './polygon';

export class Contour {
  polygon: Polygon = null!;
  cutouts: Polygon[] = [];
}
