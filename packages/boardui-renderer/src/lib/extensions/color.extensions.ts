import { Color } from 'boardui-parser';

export function getSvgColor(color: Color): string {
  return `rgb(${color.r},${color.g},${color.b})`;
}
