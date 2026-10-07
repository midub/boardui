import { DemoModels, DemoSession, exposeDemo } from '@boardui/demo-shared';
import { SAMPLE_SIZES } from '@boardui/demo-shared/sizes';

/** Opening boards (`DemoSession`): one per page. */
export const session = new DemoSession({
  samplesBase: `${import.meta.env.BASE_URL}samples/`,
  sizes: SAMPLE_SIZES,
});
/** Runtime 3D models: KiCad's libraries, and `?models=<mapping URL>`. */
export const models = new DemoModels(location.search);
exposeDemo(session, models);

/** The page's query parameters, as loaded. */
export const params = new URLSearchParams(location.search);
