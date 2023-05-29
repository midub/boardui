import { Renderer } from './renderer';
import {
  Circle,
  Component,
  Contour,
  Hole,
  Line,
  Oval,
  Pad,
  Pin,
  Polyline,
  RectCenter,
  StandardPrimitive,
} from 'boardui-parser';
import {
  ContourRenderer,
  PolylineRenderer,
  CircleRenderer,
  RectCenterRenderer,
  PinRenderer,
  ComponentRenderer,
  HoleRenderer,
  ProfileContourRenderer,
  OvalRenderer,
  LineRenderer,
} from './renderers';
import { PadRenderer } from './renderers/pad-renderer';

export class RendererProvider {
  // eslint-disable-next-line @typescript-eslint/ban-types
  private static _renderers = new Map<Function, Renderer<any>>([
    [Contour.prototype.constructor, new ContourRenderer()],
    [Polyline.prototype.constructor, new PolylineRenderer()],
    [Circle.prototype.constructor, new CircleRenderer()],
    [RectCenter.prototype.constructor, new RectCenterRenderer()],
    [Pin.prototype.constructor, new PinRenderer()],
    [Component.prototype.constructor, new ComponentRenderer()],
    [Hole.prototype.constructor, new HoleRenderer()],
    [Pad.prototype.constructor, new PadRenderer()],
    [Oval.prototype.constructor, new OvalRenderer()],
    [Line.prototype.constructor, new LineRenderer()]
  ]);

  private static _profileContourRenderer = new ProfileContourRenderer();

  static getRenderer(primitive: any): Renderer<any> {
    const renderer = RendererProvider._renderers.get(primitive.constructor);
    if (!renderer) {
      throw new Error(`Renderer for ${primitive} not found.`);
    }
    return renderer;
  }

  static getProfileRenderer(primitive: StandardPrimitive): Renderer<any> {
    if (primitive instanceof Contour) {
      return RendererProvider._profileContourRenderer;
    }

    throw new Error('Not implemented');
  }
}
