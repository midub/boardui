import { Component, Inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import {
  MatDialogModule,
  MatDialogRef,
  MAT_DIALOG_DATA,
} from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { LAYER_TYPES, LayerType, RenderProperties } from 'boardui-core';
import { IPC2581 } from 'boardui-parser';
import { CommonModule } from '@angular/common';

export interface LayersDialogData {
  renderProperties: RenderProperties;
  pcb: IPC2581;
  renderPropertiesChange: (renderProperties: RenderProperties) => void;
}

@Component({
  selector: 'app-layers-dialog',
  template: `
    <h1 mat-dialog-title>Layers</h1>
    <div mat-dialog-content style="min-width: 40vw; display: flex; flex-direction: column;">
      <span *ngFor="let layerType of layerTypes">
        <mat-checkbox class="example-margin" [checked]="isChecked(layerType)" (change)="toggleLayerType(layerType)">
          {{ layerType }}
        </mat-checkbox>
      </span>
    </div>
    <div mat-dialog-actions>
      <button mat-button mat-dialog-close>Close</button>
    </div>
  `,
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    FormsModule,
    MatButtonModule,
    MatCheckboxModule
  ],
})
export class LayersDialogComponent {
  layerTypes = LAYER_TYPES;

  constructor(
    public dialogRef: MatDialogRef<LayersDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: LayersDialogData
  ) { }

  isChecked = (layerType: LayerType): boolean => !this.data.renderProperties.layerTypesRenderProperties.find(x => x.layerType === layerType)?.invisible;

  toggleLayerType = (layerType: LayerType) => {
    const layerTypeRenderProperties = this.data.renderProperties.layerTypesRenderProperties.find(x => x.layerType === layerType);
    if (layerTypeRenderProperties) {
      layerTypeRenderProperties.invisible = !layerTypeRenderProperties.invisible;
    } else {
      this.data.renderProperties.layerTypesRenderProperties.push({
        layerType,
        invisible: false
      });
    }
    this.data.renderPropertiesChange(this.data.renderProperties);
  }
}
