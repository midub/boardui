import { Polyline, PolyStepSegment } from 'boardui-parser';

export function getPolylinePath(polyline: Polyline): string {
  const strArr = new Array<string>(polyline.polySteps.length + 1);
  strArr[0] = `M ${polyline.polyBegin.x} ${polyline.polyBegin.y}`;
  for (let i = 0; i < polyline.polySteps.length; i++) {
    const step = polyline.polySteps[i];
    if (step instanceof PolyStepSegment) {
      strArr[i + 1] = `L ${step.x} ${step.y}`;
    } else {
      strArr[i + 1] = `L ${step.x} ${step.y}`;
    }
  }

  return strArr.join(' ');
}
