import {
  modelAttributions,
  modelProblems,
  modelSummary,
  STEP_LICENSES,
} from '@boardui/demo-shared';
import { type ReactNode, useSyncExternalStore } from 'react';
import { models } from './session.js';

/** The 3D models panel: the toggle, how loading went, and the credits. */
export function Models(): ReactNode {
  const { status, shown } = useSyncExternalStore(models.subscribe, models.getState);
  const problems = modelProblems(status);
  return (
    <section className="panel models">
      <h3>3D models</h3>
      <label className="toggle">
        <input
          type="checkbox"
          id="models-toggle"
          checked={shown}
          onChange={(e) => models.setShown(e.target.checked)}
        />
        <span id="models-status">{modelSummary(status)}</span>
      </label>
      {problems && (
        <p className="muted models-problems" id="models-problems">
          {problems}
        </p>
      )}
      <p className="muted models-credits" id="models-credits">
        {modelAttributions(models.sources, status).map((a) => (
          <span key={a.text}>
            {a.url ? <a href={a.url}>{a.text}</a> : a.text}
            {a.license ? ` (${a.license})` : ''}.{' '}
          </span>
        ))}
        Fetched by footprint name; STEP read with{' '}
        {STEP_LICENSES.map((l, i) => (
          <span key={l.href}>
            {i ? ' / ' : ''}
            <a href={l.href}>{l.text}</a>
          </span>
        ))}{' '}
        (LGPL-2.1).
      </p>
    </section>
  );
}
