import { RenderProperties } from './render-properties';
import { Side } from './side';

export interface BoardViewContext {
  pcb: any;
  step: string;
  side: Side;
  renderProperties: RenderProperties;
}
