import { StatsMeter } from '@boardui/demo-shared';
import type { BoardViewerElement } from '@boardui/react';
import { type ReactNode, useEffect, useState } from 'react';

/** The `?stats` overlay: backend, frame rate, draw calls, triangles; and the spin toggle. */
export function Stats({
  viewer,
  spin,
  onSpin,
}: {
  /** The viewer (stable: the overlay measures from its first frame). */
  viewer: () => BoardViewerElement | null;
  spin: boolean;
  onSpin: (on: boolean) => void;
}): ReactNode {
  const [text, setText] = useState({ text: '', fps: '0.0' });
  useEffect(() => {
    const meter = new StatsMeter();
    Object.assign(globalThis, { stats: meter });
    let frame = 0;
    const tick = (time: number) => {
      const next = meter.update(time, viewer()?.stats() ?? null);
      if (next !== null) setText({ text: next, fps: meter.fps.toFixed(1) });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [viewer]);
  return (
    <div id="stats" className="stats" data-fps={text.fps}>
      <pre className="stats-text">{text.text}</pre>
      <label className="toggle">
        <input
          type="checkbox"
          id="spin-toggle"
          checked={spin}
          onChange={(e) => onSpin(e.target.checked)}
        />
        <span>spin</span>
      </label>
    </div>
  );
}
