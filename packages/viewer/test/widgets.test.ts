import { Box3, PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  anchorPoint,
  FADED_OPACITY,
  OCCLUSION_INTERVAL,
  placement,
  projectToScreen,
  WidgetLayer,
} from '../src/widgets.js';

const box = (min: [number, number, number], max: [number, number, number]) =>
  new Box3(new Vector3(...min), new Vector3(...max));

/** A camera 1 m above the origin looking down, −Z up the screen. */
function topCamera(): PerspectiveCamera {
  const camera = new PerspectiveCamera(90, 2, 0.01, 10);
  camera.position.set(0, 1, 0);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  return camera;
}

describe('anchorPoint', () => {
  it("puts 'top' on the face pointing away from the board", () => {
    const above = box([0, 0.001, -2], [2, 0.003, 0]);
    expect(anchorPoint(above, 'top').toArray()).toEqual([1, 0.003, -1]);
    const below = box([0, -0.003, -2], [2, -0.001, 0]);
    expect(anchorPoint(below, 'top').toArray()).toEqual([1, -0.003, -1]);
  });

  it("puts 'center' and offsets relative to the centre", () => {
    const b = box([0, 0, 0], [2, 2, 2]);
    expect(anchorPoint(b, 'center').toArray()).toEqual([1, 1, 1]);
    expect(anchorPoint(b, [0.5, 0, -1]).toArray()).toEqual([1.5, 1, 0]);
  });
});

describe('projectToScreen', () => {
  it('maps the view centre to the viewport centre, −Z upwards', () => {
    const camera = topCamera();
    const centre = projectToScreen(new Vector3(0, 0, 0), camera, 800, 400);
    expect(centre?.x).toBeCloseTo(400);
    expect(centre?.y).toBeCloseTo(200);
    const up = projectToScreen(new Vector3(0, 0, -0.5), camera, 800, 400);
    expect(up?.x).toBeCloseTo(400);
    expect(up?.y).toBeCloseTo(100); // fov 90°: half a metre at 1 m is half the half-height
    const right = projectToScreen(new Vector3(0.5, 0, 0), camera, 800, 400);
    expect(right?.x).toBeCloseTo(500);
  });

  it('returns null behind the camera', () => {
    expect(projectToScreen(new Vector3(0, 2, 0), topCamera(), 800, 400)).toBeNull();
  });
});

describe('placement', () => {
  const options = { anchor: 'top', offset: [0, -8], occlusion: 'fade' } as const;

  it('translates to the point plus offset, sitting above a top anchor', () => {
    expect(placement({ x: 100, y: 50 }, options, false)).toEqual({
      transform: 'translate(100.0px, 42.0px) translate(-50%, -100%)',
      visibility: 'visible',
      opacity: '',
    });
    expect(placement({ x: 1, y: 2 }, { ...options, anchor: 'center' }, false).transform).toBe(
      'translate(1.0px, -6.0px) translate(-50%, -50%)',
    );
  });

  it('fades or hides occluded widgets and hides them behind the camera', () => {
    expect(placement({ x: 0, y: 0 }, options, true).opacity).toBe(String(FADED_OPACITY));
    expect(placement({ x: 0, y: 0 }, { ...options, occlusion: 'hide' }, true).visibility).toBe(
      'hidden',
    );
    expect(placement({ x: 0, y: 0 }, { ...options, occlusion: 'none' }, true).opacity).toBe('');
    expect(placement(null, options, false).visibility).toBe('hidden');
  });
});

describe('WidgetLayer', () => {
  const element = () => ({ style: {} as CSSStyleDeclaration });

  it('positions widgets and throttles occlusion checks', () => {
    const occluded = vi.fn(() => true);
    const layer = new WidgetLayer({
      box: () => box([-0.1, 0, -0.1], [0.1, 0.1, 0.1]),
      visible: () => true,
      occluded,
    });
    const widget = element();
    layer.attach('cmp/U1', widget, { offset: [0, -4] });
    const camera = topCamera();
    layer.update(camera, 800, 400, 1000);
    expect(widget.style.transform).toBe('translate(400.0px, 196.0px) translate(-50%, -100%)');
    expect(widget.style.opacity).toBe(String(FADED_OPACITY));
    layer.update(camera, 800, 400, 1000 + OCCLUSION_INTERVAL / 2);
    expect(occluded).toHaveBeenCalledTimes(1);
    expect(occluded).toHaveBeenCalledWith('cmp/U1', new Vector3(0, 1, 0), new Vector3(0, 0.1, 0));
    layer.update(camera, 800, 400, 1000 + OCCLUSION_INTERVAL);
    expect(occluded).toHaveBeenCalledTimes(2);
  });

  it('hides widgets whose element has no geometry', () => {
    const layer = new WidgetLayer({ box: () => null, visible: () => true, occluded: () => false });
    const widget = element();
    layer.attach('feat/TOP/9', widget);
    layer.update(topCamera(), 800, 400, 0);
    expect(widget.style.visibility).toBe('hidden');
  });

  it('hides widgets whose element is not drawn', () => {
    let visible = false;
    const occluded = vi.fn(() => false);
    const layer = new WidgetLayer({
      box: () => box([0, 0, 0], [0.1, 0.1, 0.1]),
      visible: () => visible,
      occluded,
    });
    const widget = element();
    layer.attach('cmp/U1', widget);
    layer.update(topCamera(), 800, 400, 0);
    expect(widget.style.visibility).toBe('hidden');
    expect(occluded).not.toHaveBeenCalled();
    visible = true;
    layer.update(topCamera(), 800, 400, 1);
    expect(widget.style.visibility).toBe('visible');
  });

  it('clears its styles on detach', () => {
    const layer = new WidgetLayer({
      box: () => box([0, 0, 0], [0, 0, 0]),
      visible: () => true,
      occluded: () => false,
    });
    const widget = element();
    const detach = layer.attach('board', widget, { occlusion: 'none' });
    layer.update(topCamera(), 800, 400, 0);
    expect(widget.style.transform).not.toBe('');
    detach();
    expect(layer.size).toBe(0);
    expect(widget.style).toEqual({ transform: '', visibility: '', opacity: '' });
  });
});
