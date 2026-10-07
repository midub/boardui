import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import type { WidgetAnchor, WidgetOcclusion, WidgetOptions } from '@boardui/viewer';
import { BoardViewer } from './board-viewer';

/** Options compared by value, so that an inline `[offset]="[0, -6]"` doesn't attach again. */
const optionsKey = (o: WidgetOptions) => JSON.stringify([o.anchor, o.offset, o.occlusion]);

/**
 * An HTML widget that follows a board element (`attachWidget`): the viewer positions this
 * component's element, with its content, over the board. Must be inside a {@link BoardViewer}.
 *
 * The widget attaches once the viewer has loaded a board with the element (`bui-load`; at once if
 * it already has), detaches just before that board is replaced (`bui-unload`), and attaches again
 * if the next board has the element too; its content stays as it is. Without a board, or while
 * the board lacks the element, the widget isn't shown.
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

  constructor() {
    const viewer = inject(BoardViewer).element;
    const host: HTMLElement = inject(ElementRef).nativeElement;
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
    // Changes for every board the viewer loads (`bui-load`); `0` while it has none.
    const board = signal(viewer.loaded ? 1 : 0);
    const onLoad = () => board.update((n) => n + 1);
    // Detaches before the board is replaced: an effect would run after the next board's
    // `bui-load`, too late.
    let detach: (() => void) | null = null;
    const release = () => {
      detach?.();
      detach = null;
    };
    viewer.addEventListener('bui-load', onLoad);
    viewer.addEventListener('bui-unload', release);
    inject(DestroyRef).onDestroy(() => {
      viewer.removeEventListener('bui-load', onLoad);
      viewer.removeEventListener('bui-unload', release);
    });

    effect((onCleanup) => {
      const target = this.target();
      const opts = options();
      if (!board()) return;
      try {
        detach = viewer.attachWidget(target, host, opts);
      } catch {
        // No such element on this board.
      }
      onCleanup(release);
    });
  }
}
