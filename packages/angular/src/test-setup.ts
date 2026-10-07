// jsdom has no WebGPU, WebGL or ResizeObserver. The tests are bundled, so `vi.mock` can't replace
// the renderer as in the other packages: a WebGPU adapter that never comes keeps the viewer's
// renderer from becoming ready, and the element does everything but render.
Object.defineProperty(navigator, 'gpu', {
  configurable: true,
  value: { requestAdapter: () => new Promise(() => {}) },
});

globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};

// Nor `Element.part`, which the viewer's shadow DOM uses.
if (!('part' in Element.prototype)) {
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
