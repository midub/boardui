/** Formatting of sizes, counts and durations. */

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
