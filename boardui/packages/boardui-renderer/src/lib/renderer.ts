import { RenderContext } from './render-context';

export interface Renderer<T> {
  render(part: T, target: Node, context: RenderContext): void;
}
