/**
 * Declares types of layers.
 */
export type LayerType =
  /** Profile/Outline layer. */
  | 'PROFILE'

  /** Signal (Conductive) layer. */
  | 'SIGNAL'

  /** Silkscreen layer. */
  | 'SILKSCREEN'

  /** Documentation layer. */
  | 'DOCUMENTATION'

  /** Drill layer. */
  | 'DRILL'

  /** Component layer. */
  | 'COMPONENT';

export const LAYER_TYPES: LayerType[] = ['PROFILE', 'SIGNAL', 'SILKSCREEN', 'DOCUMENTATION', 'DRILL', 'COMPONENT'];
