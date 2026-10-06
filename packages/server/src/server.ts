import { createServer as createHttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer } from 'ws';
import { HEARTBEAT_MS } from './protocol.js';
import { createRooms } from './rooms.js';
import { attachSession } from './session.js';
import { serveStatic } from './static-files.js';
import { createWebSocketTransport } from './websocket.js';

export interface ServerOptions {
  port: number;
  host?: string;
  /** Directory with the built simulator; omit to serve only /ws and /healthz. */
  staticDir?: string;
  heartbeatMs?: number;
}

/** Audio chunks are at most 1 s; this leaves room for 192 kHz stereo. */
const MAX_PAYLOAD_BYTES = 1024 * 1024;

export async function startServer(options: ServerOptions) {
  const rooms = createRooms();
  const serveFiles = options.staticDir ? serveStatic(options.staticDir) : undefined;

  const http = createHttpServer((request, response) => {
    if (request.url === '/healthz') {
      response.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
      return;
    }
    if (serveFiles) serveFiles(request, response);
    else response.writeHead(404).end('Not found');
  });

  const wss = new WebSocketServer({ server: http, path: '/ws', maxPayload: MAX_PAYLOAD_BYTES });
  createWebSocketTransport(wss, options.heartbeatMs ?? HEARTBEAT_MS).onConnection((connection) => {
    attachSession(connection, rooms);
  });

  await new Promise<void>((done) => http.listen(options.port, options.host, done));
  const { port } = http.address() as AddressInfo;

  return {
    port,
    rooms,
    async close(): Promise<void> {
      rooms.disposeAll();
      for (const client of wss.clients) client.terminate();
      await new Promise<void>((done) => wss.close(() => http.close(() => done())));
    },
  };
}
