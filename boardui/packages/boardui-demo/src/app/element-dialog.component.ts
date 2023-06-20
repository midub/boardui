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

export interface ElementDialogData {
  type: string;
  json: string;
}

@Component({
  selector: 'app-element-dialog',
  template: `
    <h1 mat-dialog-title>PCB element data preview</h1>
    <div mat-dialog-content style="min-width: 40vw;">
        Element type: {{data.type}}<br/>
        Data:
        <pre><code style="cursor: text;">{{data.json}}</code></pre>
    </div>
    <div mat-dialog-actions>
      <button mat-button mat-dialog-close>Close</button>
    </div>
  `,
  standalone: true,
  imports: [
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    FormsModule,
    MatButtonModule,
  ],
})
export class ElementDialogComponent {
  constructor(
    public dialogRef: MatDialogRef<ElementDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: ElementDialogData
  ) {}
}
