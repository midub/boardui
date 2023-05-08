import { Color, ColorRef, FillDesc } from 'boardui-parser';
import { ReusablesProvider } from '../reusables-provider';
import { getSvgColor } from './color.extensions';

export function getFillDescSVGAttributes(
  fillDesc: FillDesc,
  reusablesProvider: ReusablesProvider
): [string, string][] {
  const attributes: [string, string][] = [];

  if (fillDesc.fillProperty === 'VOID') {
    attributes.push(['fill', 'none']);
  } else {
    const fillColor =
      fillDesc.color instanceof ColorRef
        ? reusablesProvider.getColorById(fillDesc.color.id)
        : fillDesc.color;
    if (fillColor) {
      attributes.push(['fill', getSvgColor(fillColor)]);
    }
  }

  return attributes;
}
