/* eslint-disable @typescript-eslint/no-non-null-assertion */
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnDestroy,
  Output,
  ViewChild,
} from '@angular/core';
import { IPC2581, Component as IPCComponent, Pad } from 'boardui-parser';
import { BoardViewContext, RenderProperties, Side } from 'boardui-core';
import { TemplateCollection as TemplateCollection } from '../template/template-collection';
import {
  ElementMap,
  ReusablesProvider,
  ReusablesRepository,
  SVGPCBRenderer,
} from 'boardui-renderer';
import { ElementEvent } from '../events/element-event';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { RenderDoneEvent } from '../events/render-done-event';
import { Subject, debounceTime } from 'rxjs';

@Component({
  selector: 'bui-viewer',
  templateUrl: './viewer.component.html',
  styleUrls: ['./viewer.component.scss'],
  providers: [TemplateCollection],
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ViewerComponent implements AfterViewInit, OnDestroy {
  @ViewChild('viewerContainer') private _viewerContainer!: ElementRef;
  @ViewChild('toolbarContainer') private _toolbarContainer!: ElementRef;

  /* #region fields */
  private _pcb: IPC2581 | null = null;
  private _side: Side = 'TOP';
  private _step: string | null = null;
  private _renderProperties: RenderProperties | null = null;
  private _zoom = 1;
  private _zoomMin = 0;
  private _zoomMax = Number.MAX_VALUE;
  private _elementMap: ElementMap = new ElementMap();
  private _reusablesProvider: ReusablesProvider | null = null;
  public _pcbHtml: SafeHtml | null = null;
  private _translate: [number, number] = [0, 0];
  private _mousePosition: [number, number] = [0, 0];
  private _mouseOverTimeout: number | null = null;
  private _mouseOverElement: SVGElement | null = null;
  private _tooltipContainer: HTMLDivElement | null = null;
  private _viewContextChange: EventEmitter<void> = new EventEmitter();
  private _viewContextChangeDebouncer: Subject<void> = new Subject();
  private _transformChange: EventEmitter<void> = new EventEmitter();
  /* #endregion */

  /* #region inputs */

  @Input()
  public set pcb(pcb: IPC2581 | null) {
    this._pcb = pcb;
    this._reusablesProvider = pcb ? new ReusablesRepository(pcb) : null;
    this._viewContextChangeDebouncer.next();
  }

  @Input()
  public set side(side: Side) {
    this._side = side;
    this._viewContextChangeDebouncer.next();
  }

  @Input()
  public set step(step: string | null) {
    this._step = step;
    this._viewContextChangeDebouncer.next();
  }

  @Input()
  public set renderProperties(renderProperties: RenderProperties | null) {
    this._renderProperties = renderProperties;
    this._viewContextChangeDebouncer.next();
  }

  @Input()
  public set zoom(value: number) {
    if (value < this._zoomMin) value = this._zoomMin;
    if (value > this._zoomMax) value = this._zoomMax;
    
    this._zoom = value;
    this._transformChange.emit();
  }

  @Input()
  public set zoomMin(value: number) {
    this._zoomMin = value;
  }

  @Input()
  public set zoomMax(value: number) {
    this._zoomMax = value;
  }

  /* #endregion */

  /* #region outputs */

  @Output() zoomChange: EventEmitter<number> = new EventEmitter();

  @Output() elementClick: EventEmitter<ElementEvent> = new EventEmitter();

  @Output() elementHover: EventEmitter<ElementEvent> = new EventEmitter();

  @Output() renderDone: EventEmitter<RenderDoneEvent> = new EventEmitter();

  /* #endregion */

  private get viewContext(): BoardViewContext | null {
    if (this._pcb && this._side && this._step && this._renderProperties)
      return {
        pcb: this._pcb,
        side: this._side,
        step: this._step,
        renderProperties: this._renderProperties,
      };
    return null;
  }

  constructor(
    private _templateCollection: TemplateCollection,
    private _viewerElement: ElementRef,
    private _domSanitizer: DomSanitizer
  ) {
    this.elementHover.subscribe((e) => this.renderTooltipTemplate(e));
    this._viewContextChange.subscribe(() => this.render());
    this._viewContextChangeDebouncer
      .pipe(debounceTime(50))
      .subscribe(() => this._viewContextChange.emit());
    this._transformChange.subscribe(() => this.transformPCB());
    this._transformChange.subscribe(() => this.transformTooltip());
  }

  ngAfterViewInit(): void {
    this._viewContextChangeDebouncer.next();
    setTimeout(() => {
      const toolbarTemplate = this._templateCollection.get('toolbar');
      toolbarTemplate?.render(this._toolbarContainer.nativeElement, this);
    });
  }

  ngOnDestroy(): void {
    this.clearTooltip();
  }

  private render() {
    if (this.viewContext) {
      const elementMap = new ElementMap();
      const { pcb, step, side, renderProperties } = this.viewContext;
      const pcbRenderer = new SVGPCBRenderer(
        this._reusablesProvider!,
        renderProperties
      );
      let error = null;
      try {
        const pcbElement = pcbRenderer.render(pcb, step, side, elementMap);
        this._elementMap = elementMap;
        this._pcbHtml = this._domSanitizer.bypassSecurityTrustHtml(
          pcbElement.outerHTML
        );
        this._transformChange.emit();
      } catch (e) {
        console.error(e);
        error = e;
      } finally {
        this.renderDone.emit({
          pcb,
          step,
          side,
          elementMap,
          renderProperties: this._renderProperties!,
          error,
        });
      }
    } else {
      this._pcbHtml = null;
    }
  }

  private transformPCB() {
    if (this._pcbHtml) {
      const zoom = Math.floor(this._zoom * 100) / 100;
      const translateX = Math.floor(this._translate[0] * 1000) / 1000;
      const translateY = Math.floor(this._translate[1] * 1000) / 1000;

      this._viewerContainer.nativeElement.style.transform = `scale(${zoom},${zoom}) translate3d(${translateX}px,${-translateY}px,0)`;
    }
  }

  /* #region events */

  @HostListener('click', ['$event'])
  private onClick(e: MouseEvent): void {
    const target = e.target as SVGElement;
    const element = this.findElement(target);
    if (element) {
      const eventData: ElementEvent = {
        originalEvent: e,
        element,
      };
      this.elementClick.emit(eventData);
    }
    e.preventDefault();
  }

  @HostListener('pointerover', ['$event'])
  private onPointerOver(e: MouseEvent): void {
    this._mousePosition = [e.pageX, e.pageY];
    this._mouseOverElement = this.findElement(e.target as SVGElement);
    if (this._mouseOverElement) {
      this._mouseOverTimeout = window.setTimeout(() => {
        this.elementHover.emit({
          originalEvent: e,
          element: this._mouseOverElement,
        });
      }, 350);
    }
    this._transformChange.emit();
    e.preventDefault();
  }

  @HostListener('pointerout', ['$event'])
  private onPointerOut(e: MouseEvent): void {
    const toElement = this.findElementId(e.relatedTarget as SVGElement);
    if (this._mouseOverElement !== toElement) {
      if (this._mouseOverTimeout) {
        window.clearTimeout(this._mouseOverTimeout);
      }
      this.clearTooltip();
    }
    e.preventDefault();
  }

  @HostListener('pointermove', ['$event'])
  private onPointerMove(e: MouseEvent): void {
    this._mousePosition = [e.pageX, e.pageY];
    if (e.buttons & 1) {
      this._translate[0] += e.movementX / this._zoom;
      this._translate[1] -= e.movementY / this._zoom;
    }
    this._transformChange.emit();
    e.preventDefault();
  }

  @HostListener('wheel', ['$event'])
  private onWheel(e: WheelEvent): void {
    const step = Math.abs(e.deltaY / 300);
    if (e.deltaY > 0) {
      this.setZoom(-step, e.pageX, e.pageY);
    }
    if (e.deltaY < 0) {
      this.setZoom(step, e.pageX, e.pageY);
    }
    e.preventDefault();
  }

  /* #endregion */

  private setZoom(step: number, centerX: number, centerY: number): void {
    const viewerBounds =
      this._viewerElement.nativeElement.getBoundingClientRect();
    const viewerCenterX =
      viewerBounds.left + viewerBounds.width / 2 + window.scrollX;
    const viewerCenterY =
      viewerBounds.top + viewerBounds.height / 2 + window.scrollY;
    const centerOffsetX = viewerCenterX - centerX;
    const centerOffsetY = viewerCenterY - centerY;
    const movementX = centerOffsetX / this._zoom;
    const movementY = centerOffsetY / this._zoom;
    this._translate[0] += movementX * step * 2;
    this._translate[1] -= movementY * step * 2;
    this.zoom = this._zoom *= 1 + step;
  }

  /* #region templates */

  private renderTooltipTemplate(e: ElementEvent): void {
    let tooltip = null;
    if (e.element instanceof IPCComponent) {
      tooltip = this._templateCollection.get('componentTooltip');
    }
    if (e.element instanceof Pad) {
      tooltip = this._templateCollection.get('padTooltip');
    }

    if (tooltip) {
      const tooltipContainer = document.createElement('div');
      tooltipContainer.classList.add('bui-tooltip');
      tooltipContainer.onmouseover = (e) => e.preventDefault();

      tooltip?.render(tooltipContainer, e.element);

      this._tooltipContainer?.remove();
      this._tooltipContainer = tooltipContainer;
      document.body.appendChild(this._tooltipContainer);
      this.transformTooltip();
    }
  }

  private clearTooltip(): void {
    this._tooltipContainer?.remove();
  }

  private transformTooltip(): void {
    const tooltip = this._tooltipContainer;
    if (tooltip) {
      const tooltipWidth = tooltip.clientWidth;
      let left = this._mousePosition[0];
      if (left + tooltipWidth > document.body.clientWidth) {
        left -= tooltipWidth + 8;
      } else {
        left += 8;
      }

      const tooltipHeight = tooltip.clientHeight;
      let top = this._mousePosition[1];
      if (top + tooltipHeight > document.body.clientHeight) {
        top -= tooltipHeight + 8;
      } else {
        top += 8;
      }

      tooltip.style.transform = `translate3d(${left}px,${top}px,0)`;
    }
  }

  /* #endregion */

  /* #region helpers */
  private findElement(part: SVGElement): any | null {
    const id = this.findElementId(part);
    if (id) {
      const element = this._elementMap.getElement(+id);
      return element;
    }
    return null;
  }

  private findElementId(element: SVGElement | null): string | null {
    let depth = 0;
    while (element && !element.id && depth < 2) {
      element = element.parentNode as SVGElement | null;
      depth++;
    }

    return element?.id ?? null;
  }
  /* #endregion */
}
