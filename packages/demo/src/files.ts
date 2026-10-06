/**
 * What the user dropped or picked: an IPC-2581 file, a boardui GLB, or a board with a model
 * mapping and its model files. Folders are walked, so a dropped project folder works too.
 */

/** A file with its path relative to what was dropped (folders included). */
export interface InputFile {
  path: string;
  file: File;
}

/** What to open. */
export type Opened =
  | { kind: 'ipc2581'; xml: File; mapping?: InputFile; models: InputFile[] }
  | { kind: 'glb'; glb: File };

/** Files from a drop, walking dropped folders. */
export async function filesFromDrop(transfer: DataTransfer): Promise<InputFile[]> {
  const entries = [...transfer.items]
    .map((item) => item.webkitGetAsEntry?.())
    .filter((entry): entry is FileSystemEntry => !!entry);
  if (!entries.length) return filesFromList(transfer.files);
  const out: InputFile[] = [];
  for (const entry of entries) await walk(entry, '', out);
  return out;
}

/** Files from an `<input type="file">`, with folder paths when a folder was picked. */
export function filesFromList(list: FileList | readonly File[]): InputFile[] {
  return [...list].map((file) => ({ path: file.webkitRelativePath || file.name, file }));
}

async function walk(entry: FileSystemEntry, prefix: string, out: InputFile[]): Promise<void> {
  const path = prefix + entry.name;
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) =>
      (entry as FileSystemFileEntry).file(resolve, reject),
    );
    out.push({ path, file });
  } else if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
        reader.readEntries(resolve, reject),
      );
      if (!batch.length) break;
      for (const child of batch) await walk(child, `${path}/`, out);
    }
  }
}

const extension = (path: string) => path.slice(path.lastIndexOf('.') + 1).toLowerCase();
const dir = (path: string) => path.slice(0, path.lastIndexOf('/') + 1);

/** Whether a GLB is a boardui asset (`BOARDUI_board` in its JSON chunk). */
async function isBoardGlb(file: File): Promise<boolean> {
  const head = new DataView(await file.slice(0, 20).arrayBuffer());
  if (head.byteLength < 20 || head.getUint32(0, true) !== 0x46546c67) return false;
  const length = head.getUint32(12, true);
  const json = await file.slice(20, 20 + Math.min(length, 1 << 24)).text();
  return json.includes('"BOARDUI_board"');
}

/** Whether a JSON file looks like a model mapping (`spec/schema/models.schema.json`). */
async function isMapping(file: File): Promise<boolean> {
  try {
    const json = JSON.parse(await file.text()) as { version?: unknown; models?: unknown };
    return json.version === 1 && Array.isArray(json.models);
  } catch {
    return false;
  }
}

/**
 * Decides what to open: the first IPC-2581 file (with a model mapping and the other files as
 * models, paths made relative to the mapping), else the first boardui GLB.
 *
 * @throws an `Error` with a message for the user if nothing can be opened.
 */
export async function classify(files: readonly InputFile[]): Promise<Opened> {
  const xml = files.find((f) => extension(f.path) === 'xml');
  if (!xml) {
    for (const f of files) {
      if (extension(f.path) === 'glb' && (await isBoardGlb(f.file))) {
        return { kind: 'glb', glb: f.file };
      }
    }
    throw new Error(
      files.some((f) => extension(f.path) === 'glb')
        ? 'This GLB is not a boardui board. Drop an IPC-2581 file (.xml) to convert it.'
        : 'Drop an IPC-2581 file (.xml) or a boardui GLB.',
    );
  }
  let mapping: InputFile | undefined;
  for (const f of files) {
    if (extension(f.path) === 'json' && (await isMapping(f.file))) {
      mapping = f;
      break;
    }
  }
  const base = mapping ? dir(mapping.path) : '';
  const models = files
    .filter((f) => f !== xml && f !== mapping && extension(f.path) !== 'xml')
    .map((f) => ({
      path: f.path.startsWith(base) ? f.path.slice(base.length) : f.path,
      file: f.file,
    }));
  return mapping
    ? { kind: 'ipc2581', xml: xml.file, mapping, models }
    : { kind: 'ipc2581', xml: xml.file, models: [] };
}
