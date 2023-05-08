import { FillDescGroup, Polygon, XForm } from 'boardui-parser';

export function getPolygon(
  segments: [number, number][],
  fillDesc?: FillDescGroup,
  xform?: XForm
): Polygon {
  const polygon = new Polygon();
  polygon.polyBegin = {
    x: segments[0][0],
    y: segments[0][1],
  };
  polygon.polySteps = segments
    .slice(1)
    .map((segment) => ({ x: segment[0], y: segment[1] }));
  polygon.fillDesc = fillDesc ?? null;
  polygon.xform = xform ?? null;
  return polygon;
}
