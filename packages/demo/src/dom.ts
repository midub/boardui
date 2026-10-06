/** Small DOM helpers. */

type Child = Node | string | number | null | undefined | false;

/** Creates an element with properties (`class`, `title`, event handlers via `on…`) and children. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === false) continue;
    if (key === 'class') element.className = String(value);
    else if (key === 'dataset') Object.assign(element.dataset, value);
    else if (key === 'style') element.setAttribute('style', String(value));
    else if (key.startsWith('on') && typeof value === 'function') {
      element.addEventListener(key.slice(2), value as EventListener);
    } else if (key in element) (element as unknown as Record<string, unknown>)[key] = value;
    else element.setAttribute(key, value === true ? '' : String(value));
  }
  append(element, ...children);
  return element;
}

/** Appends children, skipping empty ones. */
export function append(parent: Element, ...children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.append(typeof child === 'number' ? String(child) : child);
  }
}

/** `document.querySelector` that throws if nothing matches. */
export function $<T extends HTMLElement = HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  return element;
}

/** Formats a byte count. */
export function formatBytes(bytes: number): string {
  if (bytes < 1e3) return `${bytes} B`;
  if (bytes < 1e6) return `${(bytes / 1e3).toFixed(0)} kB`;
  return `${(bytes / 1e6).toFixed(bytes < 1e7 ? 1 : 0)} MB`;
}

/** Formats a count with thousands separators. */
export function formatCount(n: number): string {
  return n.toLocaleString('en-US');
}

/** Formats seconds. */
export function formatSeconds(s: number): string {
  return s < 1 ? `${(s * 1000).toFixed(0)} ms` : `${s.toFixed(s < 10 ? 2 : 1)} s`;
}
