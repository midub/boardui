import { HttpClient } from '@angular/common/http';
import { AfterContentInit, Component, ViewChild } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import {
  ElementEvent,
  RenderDoneEvent,
  ViewerComponent,
} from 'boardui-angular';
import { RenderProperties, Side } from 'boardui-core';
import { CreateSAXParser, IPC2581, IPC2581Parser } from 'boardui-parser';
import { firstValueFrom } from 'rxjs';
import { ErrorDialogComponent } from './error-dialog.component';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
})
export class AppComponent implements AfterContentInit {
  @ViewChild('pcbviewer') pcbviewer!: ViewerComponent;

  title = 'pcb-viewer';

  parser: IPC2581Parser | null = null;

  pcb: IPC2581 | null = null;
  side: Side = 'TOP';
  zoom = 1.0;

  loading = false;

  get step(): string | null {
    return this.pcb?.content.stepRefs.at(0)?.name ?? null;
  }

  renderProperties: RenderProperties = {
    padding: 0.5,
    dropShadow: {
      dx: 0,
      dy: 0,
      stdDeviation: 0.02,
    },
    layerTypesRenderProperties: [
      {
        layerType: 'PROFILE',
        color: {
          r: 26,
          g: 80,
          b: 26,
        },
      },
      {
        layerType: 'SIGNAL',
        color: {
          r: 55,
          g: 105,
          b: 48,
        },
      },
      {
        layerType: 'COMPONENT',
        color: {
          r: 200,
          g: 140,
          b: 48,
        },
      },
      {
        layerType: 'SILKSCREEN',
        color: {
          r: 255,
          g: 255,
          b: 255,
        },
      },
      {
        layerType: 'DRILL',
      },
    ],
    componentRenderProperties: [
      {
        selectors: [['mountType', 'SMT']],
        outlineColor: {
          r: 255,
          g: 255,
          b: 255,
        },
      },
      {
        selectors: [['mountType', 'THMT']],
        outlineColor: {
          r: 255,
          g: 0,
          b: 0,
        },
      },
      {
        selectors: [['refDes', 'U1']],
        fillColor: {
          r: 30,
          g: 30,
          b: 30,
        },
        outlineColor: {
          r: 30,
          g: 30,
          b: 30,
        },
      },
    ],
  };

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

    function arrayBufferToStream(ab: ArrayBuffer) {
      return new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(ab));
          controller.close();
        },
      });
    }
  }

  private async loadPCB(fileStream: ReadableStream<Uint8Array>) {
    this.parser ??= new IPC2581Parser(
      await CreateSAXParser('./assets/sax-wasm.wasm')
    );

    this.pcb = await this.parser.parse(fileStream);
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

  onElementClick(e: ElementEvent) {
    console.log(e);
  }

  onElementHover(e: ElementEvent) {
    console.log(e);
  }

  onRenderDone(e: RenderDoneEvent) {
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

  zoomIn() {
    this.zoom *= 1.5;
  }

  zoomOut() {
    this.zoom /= 1.5;
  }

  flipSide() {
    this.side = this.side === 'TOP' ? 'BOTTOM' : 'TOP';
  }
}
