/**
 * The per-element state texture (docs/architecture.md, "Element state without separate objects").
 *
 * Every feature of every layer, and every component, owns one RGBA8 texel. The shader reads the
 * texel of the fragment's element: RGB is a tint colour (linear), A is the tint strength
 * (`0…254` → `0…1`), and `A = 255` hides the element.
 */

/** Linear RGB colour, each channel `0…1`. */
export type Rgb = readonly [number, number, number];

/** Alpha value that marks a hidden element. */
export const HIDDEN_ALPHA = 255;

/** Tint used for the element under the pointer. */
export const HOVER_TINT = { color: [0.05, 0.45, 1] as Rgb, strength: 0.75 };
/** Tint used for the selected element. */
export const SELECTION_TINT = { color: [1, 0.02, 0.7] as Rgb, strength: 0.8 };
/** Tint strength of {@link ElementState.highlight}. */
export const HIGHLIGHT_STRENGTH = 0.85;

const HOVER = 1;
const SELECTED = 2;
const HOVER_RGB = Uint8Array.from(HOVER_TINT.color, toByte);
const SELECTION_RGB = Uint8Array.from(SELECTION_TINT.color, toByte);

interface Highlight {
  readonly rgb: Uint8Array;
  /** Sorted, unique texel indices. */
  readonly indices: Uint32Array;
}

/**
 * CPU side of the state texture. It composes hover, selection, highlights and hidden flags into
 * one texel per element. Priority: hidden, then hover, then selection, then the most recent
 * highlight.
 */
export class ElementState {
  /** Texture width in texels. */
  readonly width: number;
  /** Texture height in texels. */
  readonly height: number;
  /** Texel data, `width × height × 4` bytes. */
  readonly data: Uint8Array;

  readonly #flags: Uint8Array;
  readonly #hidden: Uint16Array;
  readonly #owner: Uint32Array;
  readonly #highlights = new Map<number, Highlight>();
  #nextHighlight = 1;
  #hover: Uint32Array = new Uint32Array(0);
  #selection: Uint32Array = new Uint32Array(0);
  #version = 0;

  /**
   * @param count Number of elements (texels in use).
   * @param maxWidth Maximum texture width; rows are added as needed.
   */
  constructor(
    readonly count: number,
    maxWidth = 2048,
  ) {
    this.width = Math.max(1, Math.min(count, maxWidth));
    this.height = Math.max(1, Math.ceil(count / this.width));
    this.data = new Uint8Array(this.width * this.height * 4);
    this.#flags = new Uint8Array(count);
    this.#hidden = new Uint16Array(count);
    this.#owner = new Uint32Array(count);
  }

  /** Increases on every change; compare it to decide whether to upload {@link data}. */
  get version(): number {
    return this.#version;
  }

  /** Sets the hovered elements (replacing the previous ones). */
  setHover(indices: ArrayLike<number>): void {
    this.#hover = this.#setFlag(this.#hover, indices, HOVER);
  }

  /** Sets the selected elements (replacing the previous ones). */
  setSelection(indices: ArrayLike<number>): void {
    this.#selection = this.#setFlag(this.#selection, indices, SELECTED);
  }

  /**
   * Tints elements with a colour. Later highlights cover earlier ones.
   *
   * @returns A function that removes this highlight again, uncovering earlier ones.
   */
  highlight(indices: ArrayLike<number>, color: Rgb): () => void {
    const id = this.#nextHighlight++;
    const entry: Highlight = {
      rgb: Uint8Array.from(color, toByte),
      indices: sortedUnique(indices),
    };
    this.#highlights.set(id, entry);
    for (const i of entry.indices) {
      this.#owner[i] = id;
      this.#write(i);
    }
    this.#version++;
    return () => this.#removeHighlight(id);
  }

  /**
   * Hides elements. Hiding is counted: an element stays hidden until every `hide` that covers it
   * is undone.
   *
   * @returns A function that undoes this call.
   */
  hide(indices: ArrayLike<number>): () => void {
    const unique = sortedUnique(indices);
    for (const i of unique) {
      this.#hidden[i] = (this.#hidden[i] as number) + 1;
      this.#write(i);
    }
    this.#version++;
    let done = false;
    return () => {
      if (done) return;
      done = true;
      for (const i of unique) {
        this.#hidden[i] = (this.#hidden[i] as number) - 1;
        this.#write(i);
      }
      this.#version++;
    };
  }

  /** Whether any element in `[start, end)` is hovered, selected or highlighted. */
  tintedIn(start: number, end: number): boolean {
    const lists = [
      this.#hover,
      this.#selection,
      ...[...this.#highlights.values()].map((h) => h.indices),
    ];
    return lists.some((sorted) => {
      const i = lowerBound(sorted, start);
      return i < sorted.length && (sorted[i] as number) < end;
    });
  }

  /** Whether an element is hidden. */
  isHidden(index: number): boolean {
    return (this.#hidden[index] ?? 0) > 0;
  }

  #setFlag(previous: Uint32Array, indices: ArrayLike<number>, flag: number): Uint32Array {
    const next = sortedUnique(indices);
    for (const i of previous) {
      this.#flags[i] = (this.#flags[i] as number) & ~flag;
    }
    for (const i of next) {
      this.#flags[i] = (this.#flags[i] as number) | flag;
    }
    for (const i of previous) this.#write(i);
    for (const i of next) this.#write(i);
    this.#version++;
    return next;
  }

  #removeHighlight(id: number): void {
    const entry = this.#highlights.get(id);
    if (!entry) return;
    this.#highlights.delete(id);
    const newestFirst = [...this.#highlights].reverse();
    for (const i of entry.indices) {
      if (this.#owner[i] !== id) continue;
      this.#owner[i] = newestFirst.find(([, h]) => contains(h.indices, i))?.[0] ?? 0;
      this.#write(i);
    }
    this.#version++;
  }

  #write(i: number): void {
    const o = i * 4;
    const data = this.data;
    const flags = this.#flags[i] as number;
    if ((this.#hidden[i] as number) > 0) {
      data.fill(0, o, o + 3);
      data[o + 3] = HIDDEN_ALPHA;
      return;
    }
    let rgb: ArrayLike<number> | undefined;
    let strength = HIGHLIGHT_STRENGTH;
    if (flags & HOVER) {
      rgb = HOVER_RGB;
      strength = HOVER_TINT.strength;
    } else if (flags & SELECTED) {
      rgb = SELECTION_RGB;
      strength = SELECTION_TINT.strength;
    } else {
      rgb = this.#highlights.get(this.#owner[i] as number)?.rgb;
    }
    if (!rgb) {
      data.fill(0, o, o + 4);
      return;
    }
    data[o] = rgb[0] as number;
    data[o + 1] = rgb[1] as number;
    data[o + 2] = rgb[2] as number;
    data[o + 3] = Math.round(strength * (HIDDEN_ALPHA - 1));
  }
}

function toByte(channel: number): number {
  return Math.round(Math.min(1, Math.max(0, channel)) * 255);
}

function sortedUnique(indices: ArrayLike<number>): Uint32Array {
  const sorted = Uint32Array.from(indices).sort();
  let n = 0;
  for (let i = 0; i < sorted.length; i++) {
    if (i === 0 || sorted[i] !== sorted[n - 1]) {
      sorted[n++] = sorted[i] as number;
    }
  }
  return sorted.subarray(0, n);
}

function contains(sorted: Uint32Array, value: number): boolean {
  return sorted[lowerBound(sorted, value)] === value;
}

/** Index of the first element not less than `value`. */
function lowerBound(sorted: Uint32Array, value: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((sorted[mid] as number) < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
