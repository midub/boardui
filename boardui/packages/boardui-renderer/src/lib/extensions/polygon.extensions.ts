import {
  PolyBegin,
  Polygon,
  Polyline,
  PolyStepCurve,
  PolyStepSegment,
} from 'boardui-parser';
import { Bounds } from '../bounds';

export function getPolygonPath(polygon: Polygon | Polyline, cutouts: Polygon[]): string {
  const strArr = new Array<string>(1 + cutouts.length);
  strArr[0] = getPolygonPath(polygon);
  let i = 1;
  for (const cutout of cutouts) {
    strArr[i++] = getPolygonPath(cutout);
  }
  return strArr.join(' ');

  function getPolygonPath(polygon: Polygon | Polyline) {
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
    }

    return strArr.join(' ');
  }
}

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

export function getSVGArc(curve: PolyStepCurve, lastStep: PolyBegin): string {
  const start: Point = { x: lastStep.x, y: lastStep.y };
  const center: Point = { x: curve.centerX, y: curve.centerY };
  const end: Point = { x: curve.x, y: curve.y };
  const clockwise = curve.clockwise === 'true';
  const distance = getDistance(end, center);

  const [startAngle, endAngle] = getAngles(start, center, end);

  let angleDiff = clockwise ? startAngle - endAngle : endAngle - startAngle;
  if (angleDiff < 0) {
    angleDiff += 2 * Math.PI;
  }
  const largeArcFlag = angleDiff > Math.PI ? "1" : "0";
  const sweepFlag = clockwise ? "0" : "1";
  const rotationAngle = endAngle - startAngle;

  return `A ${distance} ${distance} ${rotationAngle} ${largeArcFlag} ${sweepFlag} ${curve.x} ${curve.y}`;

  function getAngles(start: Point, center: Point, end: Point): [number, number] {
    if (Math.abs(start.x - end.x) < 1E-09 && Math.abs(start.y - end.y) < 1E-09) {
      return [0, 0];
    }
    else {
      return [
        Math.atan2(start.y - center.y, start.x - center.x),
        Math.atan2(end.y - center.y, end.x - center.x)
      ];
    }
  }

  function getDistance(start: Point, end: Point): number {
    const y = end.x - start.x;
    const x = end.y - start.y;

    return Math.sqrt(x * x + y * y);
  }

  interface Point { x: number, y: number }
}