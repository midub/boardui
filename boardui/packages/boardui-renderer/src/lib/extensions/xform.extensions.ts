import { XForm } from 'boardui-parser';

declare module 'boardui-parser' {
  interface XForm {
    getSVGTransformation(): string;
  }
}

XForm.prototype.getSVGTransformation = function (): string {
  const transformations = [];

  if (this.mirror) {
    if (this.scale) {
      transformations.push(`scale(-${this.scale},${this.scale})`);
    } else {
      transformations.push('scale(-1,1)');
    }
  }

  if (this.rotation) {
    transformations.push(`rotate(${this.rotation})`);
  }
  // TODO: Implement more transformation, check if all can be done using transform attribute.

  return transformations.join(' ');
};
