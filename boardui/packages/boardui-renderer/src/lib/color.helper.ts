import { Color } from 'boardui-core';

export class ColorHelper {
  static getSVGColor(color: Color) {
    return `rgb(${color.r},${color.g},${color.b})`;
  }
}
