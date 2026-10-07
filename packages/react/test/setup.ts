// jsdom has no WebGL, WebGPU or ResizeObserver: the viewer's renderer never becomes ready, so the
// element does everything but render.
import { vi } from 'vitest';

vi.mock('three/webgpu', async (importOriginal) => ({
  ...(await importOriginal<typeof import('three/webgpu')>()),
  WebGPURenderer: class {
    toneMapping = 0;
    info = { autoReset: true };
    setPixelRatio(): void {}
    init(): Promise<void> {
      return new Promise(() => {});
    }
  },
}));

globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};

// Nor `Element.part`, which the viewer's shadow DOM uses.
if (globalThis.Element && !('part' in Element.prototype)) {
  Object.defineProperty(Element.prototype, 'part', {
    get(this: Element) {
      return {
        add: (...tokens: string[]) =>
          this.setAttribute(
            'part',
            [this.getAttribute('part'), ...tokens].filter(Boolean).join(' '),
          ),
      };
    },
  });
}
