export class XForm {
  xOffset: number | null = null;
  yOffset: number | null = null;
  rotation: number | null = null;
  mirror: boolean | null = null;
  scale: string | null = null; // TODO: Handle correctly as described in IPC-2581.
  faceUp: boolean | null = null;
}
