import { NgModule } from '@angular/core';
import { TemplateDirective } from './template/template.directive';
import { ViewerComponent } from './viewer.component/viewer.component';

@NgModule({
  imports: [ViewerComponent, TemplateDirective],
  exports: [ViewerComponent, TemplateDirective],
})
export class BoardUIModule {}
