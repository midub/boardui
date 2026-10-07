/**
 * A static file server for the built site (`buildSite`), as GitHub Pages serves it: `<dir>` at
 * `/boardui/`, `index.html` for directories. Used by the e2e tests.
 */
import { createReadStream, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.xml': 'application/xml',
};

const isFile = (path: string) => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

/** Serves `dir` at `base` on `port` (127.0.0.1). */
export function serveSite(dir: string, port: number, base = '/boardui/'): Server {
  const root = normalize(dir + sep);
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    let path: string;
    try {
      path = decodeURIComponent(url.pathname);
    } catch {
      path = '';
    }
    if (`${path}/` === base) {
      res.writeHead(301, { location: base + url.search }).end();
      return;
    }
    let file = path.startsWith(base) ? normalize(join(root, path.slice(base.length))) : '';
    if (file && !isFile(file)) file = join(file, 'index.html');
    if (!file.startsWith(root) || !isFile(file)) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
      return;
    }
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      'content-length': statSync(file).size,
    });
    createReadStream(file).pipe(res);
  });
  return server.listen(port, '127.0.0.1');
}
