import { ApplicationRef, enableProdMode, importProvidersFrom } from '@angular/core';

import { AppModule } from './app/app.module';
import { environment } from './environment';
import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';

if (environment.production) {
  enableProdMode();
}

bootstrapApplication(AppComponent, {
  providers: [
    importProvidersFrom(AppModule)
  ]
});