// @vitest-environment node
// Server-side rendering: importing the wrapper (and so the viewer) works without a DOM.

import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BoardViewer, Widget } from '../src/index.js';

describe('server-side rendering', () => {
  it('renders a plain <board-viewer> tag', () => {
    expect(globalThis.customElements).toBeUndefined();
    const html = renderToString(
      <BoardViewer src="board.glb" className="viewer" autoRotate xray>
        <Widget target="cmp/R1">R1</Widget>
      </BoardViewer>,
    );
    expect(html).toBe('<board-viewer src="board.glb" class="viewer"></board-viewer>');
  });
});
