import { cpSync, createReadStream, mkdirSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Licences of third-party code that the demos load at runtime, by their path in a build
 * (`licenses/…`): OpenCascade and occt-import-js (LGPL-2.1), which read STEP models in a worker
 * (`@boardui/models`).
 */
export function thirdPartyLicenses(): Record<string, string> {
  const occt = join(dirname(fileURLToPath(import.meta.resolve('@boardui/models'))), '../occt');
  return {
    'licenses/occt-import-js.txt': join(occt, 'LICENSE.occt-import-js.txt'),
    'licenses/occt.txt': join(occt, 'LICENSE.occt.txt'),
  };
}

/** Copies the third-party licences to `<outDir>/licenses/`. */
export function stageLicenses(outDir: string): void {
  for (const [path, file] of Object.entries(thirdPartyLicenses())) {
    const to = join(outDir, path);
    mkdirSync(dirname(to), { recursive: true });
    cpSync(file, to);
  }
}

/** Connect-style middleware serving the licences under `<base>licenses/` in dev. */
export function licensesMiddleware(base: string) {
  const files = thirdPartyLicenses();
  return (req: IncomingMessage, res: ServerResponse, next: () => void): void => {
    const path = decodeURIComponent((req.url ?? '').split('?')[0] ?? '');
    const file = path.startsWith(base) ? files[path.slice(base.length)] : undefined;
    if (!file) {
      next();
      return;
    }
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    createReadStream(file).pipe(res);
  };
}
