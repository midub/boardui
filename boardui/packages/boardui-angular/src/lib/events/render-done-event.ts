import { RenderProperties, Side } from 'boardui-core';
import { IPC2581 } from 'boardui-parser';
import { ElementMap } from 'boardui-renderer';

export interface RenderDoneEvent {
  pcb: IPC2581;
  side: Side;
  step: string;
  elementMap: ElementMap;
  renderProperties: RenderProperties;
}
