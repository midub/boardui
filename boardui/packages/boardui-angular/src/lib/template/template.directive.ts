import {
  Directive,
  TemplateRef,
  ViewContainerRef,
  Input,
  Renderer2,
  NgZone,
  EmbeddedViewRef,
  OnDestroy,
  OnInit,
} from '@angular/core';
import { Template } from './template';
import { TemplateCollection } from './template-collection';

@Directive({
  selector: '[buiTemplate]',
  standalone: true,
})
export class TemplateDirective implements Template, OnInit, OnDestroy {
  @Input()
  set buiTemplateOf(value: any) {
    this.name = value;
  }
  name!: string;

  constructor(
    private _templateRef: TemplateRef<any>,
    private _viewContainerRef: ViewContainerRef,
    private _renderer: Renderer2,
    private _zone: NgZone,
    private _templateCollection: TemplateCollection
  ) {}

  ngOnInit(): void {
    this._templateCollection.add(this);
  }

  ngOnDestroy(): void {
    this._templateCollection.remove(this.name);
  }

  private renderTemplate(target: any, data: any): EmbeddedViewRef<any> {
    const childView = this._viewContainerRef.createEmbeddedView(
      this._templateRef,
      {
        $implicit: data,
      }
    );

    childView.rootNodes.forEach((element) => {
      this._renderer.appendChild(target, element);
    });

    return childView;
  }

  /** Renders template
   * @param target Target element to render template into
   * @param data Data passed to template as $implicit
   */
  render(target: any, data: any): any[] {
    const childView = this._zone.isStable
      ? this._zone.run(() => this.renderTemplate(target, data))
      : this.renderTemplate(target, data);
    childView.detectChanges();
    return childView.rootNodes;
  }
}
