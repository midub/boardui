import { DemoSession, exposeDemo } from '@boardui/demo-shared';
import { SAMPLE_SIZES } from '@boardui/demo-shared/sizes';

/** Opening boards (`DemoSession`): one per page. */
export const session = new DemoSession({
  samplesBase: `${import.meta.env.BASE_URL}samples/`,
  sizes: SAMPLE_SIZES,
});
exposeDemo(session);

/** The page's query parameters, as loaded. */
export const params = new URLSearchParams(location.search);
