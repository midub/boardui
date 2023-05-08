import { LineDesc } from 'boardui-parser';

export function getLineDescSVGAttributes(
  lineDesc: LineDesc
): [string, string][] {
  let strokeLinecap;
  if (lineDesc.lineEnd === 'ROUND') {
    strokeLinecap = 'round';
  } else if (lineDesc.lineEnd === 'SQUARE') {
    strokeLinecap = 'square';
  } else {
    strokeLinecap = 'square';
  }

  return [
    ['stroke-linecap', strokeLinecap],
    ['stroke-width', lineDesc.lineWidth],
    // TODO: Add lineProperty support.
  ];
}
