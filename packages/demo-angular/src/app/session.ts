import type { BoardViewerElement } from '@boardui/angular';
import { DemoModels, DemoSession, exposeDemo } from '@boardui/demo-shared';
import { SAMPLE_SIZES } from '@boardui/demo-shared/sizes';

/** Opening boards (`DemoSession`): one per page. The samples are next to the app (base href). */
export const session = new DemoSession({ samplesBase: 'samples/', sizes: SAMPLE_SIZES });
/** Runtime 3D models: KiCad's libraries, and `?models=<mapping URL>`. */
export const models = new DemoModels(location.search);
exposeDemo(session, models);

/** The page's viewer, once the app has started. */
export const viewer = (): BoardViewerElement => {
  if (!session.viewer) throw new Error('The viewer is not mounted');
  return session.viewer;
};

/** The page's query parameters, as loaded. */
export const params = new URLSearchParams(location.search);
