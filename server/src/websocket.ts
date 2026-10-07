import type { WebSocket, WebSocketServer } from 'ws';
import { HEARTBEAT_MS } from './protocol.js';
import type { Connection, Transport } from './transport.js';

export function createWebSocketTransport(
  server: WebSocketServer,
  heartbeatMs = HEARTBEAT_MS,
): Transport {
  return {
    onConnection(handler) {
      server.on('connection', (socket) => handler(wrapSocket(socket, heartbeatMs)));
    },
  };
}

export function wrapSocket(socket: WebSocket, heartbeatMs: number): Connection {
  // Browsers answer protocol-level pings automatically, so a missing pong means
  // the tab is gone (closed without leaving, phone asleep, network dropped).
  let alive = true;
  const heartbeat = setInterval(() => {
    if (!alive) {
      socket.terminate();
      return;
    }
    alive = false;
    socket.ping();
  }, heartbeatMs);
  socket.on('pong', () => {
    alive = true;
  });
  socket.on('close', () => clearInterval(heartbeat));
  socket.on('error', () => socket.terminate());

  return {
    send(data) {
      if (socket.readyState === socket.OPEN)
        socket.send(data, { binary: typeof data !== 'string' });
    },
    close(reason) {
      socket.close(1000, reason);
    },
    get bufferedBytes() {
      return socket.bufferedAmount;
    },
    onMessage(handler) {
      socket.on('message', (data, isBinary) => {
        if (isBinary) {
          const bytes = Array.isArray(data)
            ? Buffer.concat(data)
            : Buffer.isBuffer(data)
              ? data
              : Buffer.from(data);
          handler(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
        } else {
          handler(data.toString());
        }
      });
    },
    onClose(handler) {
      socket.on('close', handler);
    },
  };
}
