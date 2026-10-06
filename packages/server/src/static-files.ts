import { createReadStream, existsSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.map': 'application/json',
  '.woff2': 'font/woff2',
};

/**
 * Serves the built simulator so one process is the whole deployment. Unknown
 * paths fall back to index.html; nothing outside `root` can be reached.
 */
export function serveStatic(root: string) {
  const base = resolve(root);
  return (request: IncomingMessage, response: ServerResponse): void => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    let path = resolve(base, `.${normalize(decodeURIComponent(url.pathname))}`);
    if (!path.startsWith(base) || !existsSync(path) || statSync(path).isDirectory())
      path = join(base, 'index.html');
    if (!existsSync(path)) {
      response.writeHead(404).end('Not found');
      return;
    }
    response.writeHead(200, {
      'content-type': CONTENT_TYPES[extname(path)] ?? 'application/octet-stream',
      'cache-control':
        extname(path) === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
    });
    createReadStream(path).pipe(response);
  };
}
