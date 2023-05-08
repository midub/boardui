import {
  PolyBegin,
  Polygon,
  PolyStepCurve,
  PolyStepSegment,
} from 'boardui-parser';
import { Bounds } from '../bounds';

export function getPolygonPath(polygon: Polygon, cutouts: Polygon[]): string {
  const strArr = new Array<string>(1 + cutouts.length);
  strArr[0] = getPolygonPath(polygon);
  let i = 1;
  for (const cutout of cutouts) {
    strArr[i++] = getPolygonPath(cutout);
  }
  return strArr.join(' ');

  function getPolygonPath(polygon: Polygon) {
    const strArr = new Array<string>(polygon.polySteps.length + 1);
    strArr[0] = `M ${polygon.polyBegin.x} ${polygon.polyBegin.y}`;
    let lastStep: PolyBegin = polygon.polyBegin;
    for (let i = 0; i < polygon.polySteps.length; i++) {
      const step = polygon.polySteps[i];
      if (step instanceof PolyStepSegment) {
        strArr[i + 1] = `L ${step.x} ${step.y}`;
      } else {
        strArr[i + 1] = getSVGArc(step, lastStep);
      }
      lastStep = step;
      // TODO: Handle curves
    }

    return strArr.join(' ');
  }

  function getSVGArc(curve: PolyStepCurve, lastStep: PolyBegin): string {
    const rx = getDistance(+curve.x, +curve.y, +curve.centerX, +curve.centerY);
    const ry = getDistance(
      +lastStep.x,
      +lastStep.y,
      +curve.centerX,
      +curve.centerY
    );
    // TODO: Calculate correct arc.
    const xAxisRotation = 0;
    const largeArcFlag: 0 | 1 = 0;
    const sweepFlag: 0 | 1 = curve.clockwise === 'true' ? 0 : 1;

    return `A ${rx} ${ry} ${xAxisRotation} ${largeArcFlag} ${sweepFlag} ${curve.x} ${curve.y}`;

    function getDistance(x1: number, y1: number, x2: number, y2: number) {
      const y = x2 - x1;
      const x = y2 - y1;

      return Math.sqrt(x * x + y * y);
    }
  }
}

/* DOES NOT WORK :(
        const rx = curve.clockwise === "true" ?  radiusA(+lastStep.x, +lastStep.y, +curve.x, +curve.y, +curve.centerX, +curve.centerY) : radiusB(+lastStep.x, +lastStep.y, +curve.x, +curve.y, +curve.centerX, +curve.centerY);
        const ry = curve.clockwise === "true" ?  radiusB(+lastStep.x, +lastStep.y, +curve.x, +curve.y, +curve.centerX, +curve.centerY) : radiusA(+lastStep.x, +lastStep.y, +curve.x, +curve.y, +curve.centerX, +curve.centerY);
        // TODO: Calculate correct arc.
        const xAxisRotation = 0;
        const largeArcFlag: 0 | 1 = 0;
        const sweepFlag: 0 | 1 = curve.clockwise === "true" ? 0 : 1;

        return `A ${rx} ${ry} ${xAxisRotation} ${largeArcFlag} ${sweepFlag} ${curve.x} ${curve.y}`;

        function radiusA(p: number, q: number, m: number, n: number, h: number, k: number) {
            return Math.sqrt((((p - h) ^ 2) * (n - q) * (n + q - (2 * k)) / (p - m) * (p + m - (2 * h))) + ((q - k) ^ 2))
                * Math.sqrt(((p - m) * (p + m - (2 * h))) / ((n - q) * (n + q - (2 * k))));
        }

        function radiusB(p: number, q: number, m: number, n: number, h: number, k: number) {
            return Math.sqrt(((p - h) ^ 2) * (n - q) * (n + q - (2 * k)) / ((p - m) * (p + m - (2 * h))) + ((q - k) ^ 2));
        }
*/

export function getPolygonBounds(polygon: Polygon): Bounds {
  const sections = [polygon.polyBegin, ...polygon.polySteps];
  const offsetX = Math.min(...sections.map((x) => x.x!));
  const offsetY = Math.min(...sections.map((x) => x.y!));
  const width = Math.max(...sections.map((x) => x.x!)) - offsetX;
  const height = Math.max(...sections.map((x) => x.y!)) - offsetY;
  return {
    offsetX,
    offsetY,
    width,
    height,
  };
}
