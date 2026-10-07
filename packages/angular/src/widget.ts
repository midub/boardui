import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  effect,
  inject,
  input,
} from '@angular/core';
import type { WidgetAnchor, WidgetOcclusion, WidgetOptions } from '@boardui/viewer';
import { BoardViewer } from './board-viewer';

/** Options compared by value, so that an inline `[offset]="[0, -6]"` doesn't attach again. */
const optionsKey = (o: WidgetOptions) => JSON.stringify([o.anchor, o.offset, o.occlusion]);

/**
 * An HTML widget that follows a board element (`attachWidget`): the viewer positions this
 * component's element, with its content, over the board. Must be inside a {@link BoardViewer}.
 *
 * The viewer needs a loaded board that has the element: create widgets after the board has
 * loaded (e.g. after `await viewer.element.load(…)`) and remove them before loading another one.
 * A widget whose element is unknown isn't shown.
 *
 * @example
 * ```html
 * <bui-board-viewer>
 *   @for (id of tagged(); track id) {
 *     <bui-widget [target]="id" anchor="top" [offset]="[0, -6]" class="tag">{{ id }}</bui-widget>
 *   }
 * </bui-board-viewer>
 * ```
 */
@Component({
  selector: 'bui-widget',
  template: '<ng-content />',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Widget {
  /** ID of the board element to follow (spec §5), e.g. `cmp/U3`. */
  readonly target = input.required<string>();
  /** Where the widget attaches to the element; default `'top'`. */
  readonly anchor = input<WidgetAnchor | undefined>();
  /** Screen-space offset in CSS pixels, `[x, y]` with +y down; default `[0, 0]`. */
  readonly offset = input<readonly [number, number] | undefined>();
  /** What the widget does when the board hides its anchor; default `'fade'`. */
  readonly occlusion = input<WidgetOcclusion | undefined>();

  readonly #viewer = inject(BoardViewer);
  readonly #host: HTMLElement = inject(ElementRef).nativeElement;

  constructor() {
    const options = computed<WidgetOptions>(
      () => {
        const anchor = this.anchor();
        const offset = this.offset();
        const occlusion = this.occlusion();
        return {
          ...(anchor !== undefined ? { anchor } : {}),
          ...(offset !== undefined ? { offset } : {}),
          ...(occlusion !== undefined ? { occlusion } : {}),
        };
      },
      { equal: (a, b) => optionsKey(a) === optionsKey(b) },
    );
    effect((onCleanup) => {
      let detach: () => void;
      try {
        detach = this.#viewer.element.attachWidget(this.target(), this.#host, options());
      } catch {
        // No board, or no such element on it.
        return;
      }
      onCleanup(detach);
    });
  }
}
