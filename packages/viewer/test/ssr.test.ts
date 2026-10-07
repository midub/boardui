// Importing the viewer where there is no DOM (server-side rendering, e.g. through a framework
// wrapper) must not throw; the element is only defined in a browser.
import { describe, expect, it } from 'vitest';

describe('server-side import', () => {
  it('imports without a DOM', async () => {
    expect(globalThis.HTMLElement).toBeUndefined();
    expect(globalThis.customElements).toBeUndefined();
    const viewer = await import('../src/index.js');
    expect(typeof viewer.BoardViewerElement).toBe('function');
    expect(viewer.OPTIONAL_ROLES.has('PASTE')).toBe(true);
  });
});
