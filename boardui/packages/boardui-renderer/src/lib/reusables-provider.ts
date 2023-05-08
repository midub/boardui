import {
  LineDesc,
  FillDesc,
  Color,
  StandardPrimitive,
  Package,
  Layer,
} from 'boardui-parser';

export interface ReusablesProvider {
  /** Provides layer element.
   * @param name Layer name.
   */
  getLayerByName(name: string): Layer;

  /** Provides color element.
   * @param colorId Color identifier.
   */
  getColorById(colorId: string): Color;

  /** Provides line desctiptor element.
   * @param lineDescId line descriptor identifier.
   */
  getLineDescById(lineDescId: string): LineDesc;

  /** Provides fill desctiptor element.
   * @param fillDescId fill descriptor identifier.
   */
  getFillDescById(fillDescId: string): FillDesc;

  /** Provides predefined primitive.
   * @param primitiveId Primitive identifier.
   */
  getPrimitiveById(primitiveId: string): StandardPrimitive;

  /** Provides package element.
   * @param name Package name.
   */
  getPackageByName(name: string): Package;
}
