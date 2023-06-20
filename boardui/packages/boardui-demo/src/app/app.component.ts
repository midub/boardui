import { HttpClient } from '@angular/common/http';
import { AfterContentInit, Component, ViewChild } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import {
  ElementEvent,
  RenderDoneEvent,
  ViewerComponent,
} from 'boardui-angular';
import { DEFAULT_RENDER_PROPERTIES, RenderProperties, Side, arrayBufferToStream } from 'boardui-core';
import { createSAXParser, IPC2581, IPC2581Parser } from 'boardui-parser';
import { firstValueFrom } from 'rxjs';
import { ErrorDialogComponent } from './error-dialog.component';
import { ElementDialogComponent } from './element-dialog.component';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
})
export class AppComponent implements AfterContentInit {
  @ViewChild('pcbviewer') pcbviewer!: ViewerComponent;

  parser: IPC2581Parser | null = null;

  pcb: IPC2581 | null = null;
  side: Side = 'TOP';
  zoom = 1;
  loading = false;

  get step(): string | null {
    return this.pcb?.content.stepRefs.at(0)?.name ?? null;
  }

  renderProperties: RenderProperties = DEFAULT_RENDER_PROPERTIES;

  constructor(private httpClient: HttpClient, private dialog: MatDialog) {}

  async ngAfterContentInit(): Promise<void> {
    this.loading = true;
    const testcaseReq = this.httpClient.get(
      './assets/testcase10-RevC-Assembly.xml',
      {
        responseType: 'arraybuffer',
      }
    );
    const testcase = await firstValueFrom(testcaseReq);
    this.loadPCB(arrayBufferToStream(testcase));
  }

  async onFileInputChange(e: Event): Promise<void> {
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
      this.parser ??= new IPC2581Parser(
        await createSAXParser('./assets/sax-wasm.wasm')
      );
  
      this.pcb = await this.parser.parse(fileStream);
    }
    catch (e: any) {
      this.dialog.open(ErrorDialogComponent, {
        data: {
          title: 'Error during loading',
          message: e.message,
        },
      });
    }
  }

  onElementClick =(e: ElementEvent) => this.dialog.open(ElementDialogComponent, {
      data: {
        type: e.element.constructor.name,
        json: JSON.stringify(e.element, null, 2),
      },
    });

  onElementHover = (e: ElementEvent) => console.log(e);

  onRenderDone(e: RenderDoneEvent): void {
    this.loading = false;

    if (e.error) {
      this.dialog.open(ErrorDialogComponent, {
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

  demoHtml = `
  <bui-viewer
    #pcbviewer
    [pcb]="pcb"
    [step]="step"
    [side]="side"
    [renderProperties]="renderProperties"
    [(zoom)]="zoom"
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

  demoTS = ``;
}
