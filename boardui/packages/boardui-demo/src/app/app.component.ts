import { HttpClient, HttpClientModule } from '@angular/common/http';
import { AfterContentInit, Component } from '@angular/core';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { BoardUIModule, ElementEvent, RenderDoneEvent } from 'boardui-angular';
import {
  DEFAULT_RENDER_PROPERTIES,
  RenderProperties,
  Side,
  arrayBufferToStream,
} from 'boardui-core';
import { createSAXParser, IPC2581, IPC2581Parser } from 'boardui-parser';
import { firstValueFrom } from 'rxjs';
import { ErrorDialogComponent } from './error-dialog.component';
import { ElementDialogComponent } from './element-dialog.component';
import { LayersDialogComponent } from './layers-dialog.component';
import { MatButtonModule } from '@angular/material/button';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTableModule } from '@angular/material/table';
import { MatTabsModule } from '@angular/material/tabs';
import { CommonModule } from '@angular/common';

@Component({
  imports: [
    CommonModule,
    HttpClientModule,
    BoardUIModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatTableModule,
    MatTabsModule,
    MatExpansionModule,
    MatProgressSpinnerModule,
    MatDialogModule,
  ],
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
})
export class AppComponent implements AfterContentInit {
  private _parser: IPC2581Parser | null = null;
  renderProperties: RenderProperties = DEFAULT_RENDER_PROPERTIES;

  pcb: IPC2581 | null = null;
  side: Side = 'TOP';
  zoom = 1;
  loading = false;

  get step(): string | null {
    return this.pcb?.content.stepRefs.at(0)?.name ?? null;
  }

  constructor(
    private _httpClient: HttpClient,
    private _dialog: MatDialog,
  ) {}

  async ngAfterContentInit() {
    this.loading = true;
    const testcaseReq = this._httpClient.get(
      './assets/testcase10-RevC-Assembly.xml',
      {
        responseType: 'arraybuffer',
      },
    );
    const testcase = await firstValueFrom(testcaseReq);
    this.loadPCB(arrayBufferToStream(testcase));
  }

  async onFileInputChange(e: Event) {
    this.loading = true;
    const element = e.currentTarget as HTMLInputElement;
    const file: File | null | undefined = element.files?.item(0);
    if (!file) {
      throw new Error('Invalid input.');
    }

    await this.loadPCB(file.stream());
  }

  async loadPCB(fileStream: ReadableStream<Uint8Array>) {
    try {
      this._parser ??= new IPC2581Parser(
        await createSAXParser('./assets/sax-wasm.wasm'),
      );

      this.pcb = await this._parser.parse(fileStream);
    } catch (e: any) {
      this._dialog.open(ErrorDialogComponent, {
        data: {
          title: 'Error during loading',
          message: e.message,
        },
      });
    }
  }

  onElementClick = (e: ElementEvent) =>
    this._dialog.open(ElementDialogComponent, {
      data: {
        type: e.element.constructor.name,
        json: JSON.stringify(e.element, null, 2),
      },
    });

  onElementHover = (e: ElementEvent) => console.log(e);

  onRenderDone(e: RenderDoneEvent) {
    this.loading = false;

    if (e.error) {
      this._dialog.open(ErrorDialogComponent, {
        data: {
          title: 'Error during rendering',
          message: e.error.message,
        },
      });
    }
  }

  zoomIn = () => (this.zoom *= 1.5);

  zoomOut = () => (this.zoom /= 1.5);

  flipSide = () => (this.side = this.side === 'TOP' ? 'BOTTOM' : 'TOP');

  openLayersDialog = () =>
    this._dialog.open(LayersDialogComponent, {
      data: {
        renderProperties: this.renderProperties,
        pcb: this.pcb,
        renderPropertiesChange: (renderProperties: RenderProperties) =>
          (this.renderProperties = { ...renderProperties }),
      },
    });

  demoHtml = `
  <bui-viewer
    [pcb]="pcb"
    [step]="step"
    [side]="side"
    [renderProperties]="renderProperties"
    [(zoom)]="zoom"
    [zoomMin]="0.5"
    [zoomMax]="5"
    (elementClick)="onElementClick($event)"
    (elementHover)="onElementHover($event)"
    (renderDone)="onRenderDone($event)"
  >
    <div *buiTemplate="let data of 'toolbar'" class="toolbar">
      <button mat-fab title="Zoom In" (pointerdown)="zoomIn()">
        <mat-icon>zoom_in</mat-icon>
      </button>
      <button mat-fab title="Zoom Out" (pointerdown)="zoomOut()">
        <mat-icon>zoom_out</mat-icon>
      </button>
      <button mat-fab title="Flip side" (pointerdown)="flipSide()">
        <mat-icon>flip</mat-icon>
      </button>
    </div>
    <div *buiTemplate="let data of 'padTooltip'" class="tooltip">
      {{ data.padstackDefRef }}
    </div>
    <div *buiTemplate="let data of 'componentTooltip'" class="tooltip">
      {{ data.refDes }}
    </div>
  </bui-viewer>`;

  demoTS = `
  @Component({
    selector: 'app-root',
    templateUrl: './app.component.html',
    styleUrls: ['./app.component.scss'],
  })
  export class AppComponent implements AfterContentInit {
    private _parser: IPC2581Parser | null = null;
    renderProperties: RenderProperties = DEFAULT_RENDER_PROPERTIES;
  
    pcb: IPC2581 | null = null;
    side: Side = 'TOP';
    zoom = 1;
    loading = false;
  
    get step(): string | null {
      return this.pcb?.content.stepRefs.at(0)?.name ?? null;
    }
  
    constructor(private _httpClient: HttpClient, private _dialog: MatDialog) { }
  
    async ngAfterContentInit() {
      this.loading = true;
      const testcaseReq = this._httpClient.get(
        './assets/testcase10-RevC-Assembly.xml',
        {
          responseType: 'arraybuffer',
        }
      );
      const testcase = await firstValueFrom(testcaseReq);
      this.loadPCB(arrayBufferToStream(testcase));
    }
  
    async onFileInputChange(e: Event) {
      this.loading = true;
      const element = e.currentTarget as HTMLInputElement;
      const file: File | null | undefined = element.files?.item(0);
      if (!file) {
        throw new Error('Invalid input.');
      }
  
      await this.loadPCB(file.stream());
    }
  
    async loadPCB(fileStream: ReadableStream<Uint8Array>) {
      try {
        this._parser ??= new IPC2581Parser(
          await createSAXParser('./assets/sax-wasm.wasm')
        );
  
        this.pcb = await this._parser.parse(fileStream);
      }
      catch (e: any) {
        this._dialog.open(ErrorDialogComponent, {
          data: {
            title: 'Error during loading',
            message: e.message,
          },
        });
      }
    }
  
    onElementClick = (e: ElementEvent) => this._dialog.open(ElementDialogComponent, {
      data: {
        type: e.element.constructor.name,
        json: JSON.stringify(e.element, null, 2),
      },
    });
  
    onElementHover = (e: ElementEvent) => console.log(e);
  
    onRenderDone(e: RenderDoneEvent) {
      this.loading = false;
  
      if (e.error) {
        this._dialog.open(ErrorDialogComponent, {
          data: {
            title: 'Error during rendering',
            message: e.error.message,
          },
        });
      }
    }
  
    zoomIn = () => this.zoom *= 1.5;
  
    zoomOut = () => this.zoom /= 1.5;
  
    flipSide = () => this.side = this.side === 'TOP' ? 'BOTTOM' : 'TOP';
  }  
`;
}
