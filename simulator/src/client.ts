import type { ClientMessage, ServerMessage } from '@roommix/server/protocol';

export type ConnectionStatus = 'offline' | 'connecting' | 'connected' | 'reconnecting';

export interface ClientHandlers {
  status(status: ConnectionStatus, attempt: number): void;
  message(message: ServerMessage): void;
  frame(pcm: Int16Array): void;
}

const MAX_BACKOFF_MS = 10_000;
/** Outgoing audio is dropped rather than queued when the socket is this far behind. */
const MAX_OUTGOING_BUFFERED_BYTES = 256 * 1024;

/**
 * WebSocket client that re-joins by itself: the join message (with the
 * server-assigned client id once known) is replayed on every reconnect, so the
 * server replaces the old participant instead of adding a ghost.
 */
export function createClient(url: string, handlers: ClientHandlers) {
  let socket: WebSocket | null = null;
  let join: ClientMessage | null = null;
  let wanted = false;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function connect(): void {
    handlers.status(attempt === 0 ? 'connecting' : 'reconnecting', attempt);
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    socket = ws;
    ws.onopen = () => {
      attempt = 0;
      handlers.status('connected', 0);
      if (join) ws.send(JSON.stringify(join));
    };
    ws.onmessage = (event) => {
      if (typeof event.data === 'string') {
        const message = JSON.parse(event.data) as ServerMessage;
        if (message.type === 'error' && message.fatal) wanted = false; // the server will close; do not come back
        handlers.message(message);
      } else {
        handlers.frame(new Int16Array(event.data as ArrayBuffer));
      }
    };
    ws.onclose = () => {
      socket = null;
      if (!wanted) {
        handlers.status('offline', 0);
        return;
      }
      attempt++;
      handlers.status('reconnecting', attempt);
      timer = setTimeout(connect, Math.min(MAX_BACKOFF_MS, 500 * 2 ** (attempt - 1)));
    };
  }

  const isOpen = () => socket?.readyState === WebSocket.OPEN;

  return {
    join(message: ClientMessage & { type: 'join' }): void {
      join = message;
      wanted = true;
      if (isOpen()) socket?.send(JSON.stringify(message));
      else if (!socket) connect();
    },
    /** Once the server has assigned an id, reconnects re-join with it. */
    rememberClientId(clientId: string): void {
      if (join?.type === 'join') join = { ...join, clientId };
    },
    send(message: ClientMessage): void {
      if (isOpen()) socket?.send(JSON.stringify(message));
    },
    sendAudio(pcm: Int16Array): void {
      if (!isOpen() || !socket || socket.bufferedAmount >= MAX_OUTGOING_BUFFERED_BYTES) return;
      socket.send(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength) as ArrayBuffer);
    },
    leave(): void {
      wanted = false;
      join = null;
      clearTimeout(timer);
      if (isOpen()) socket?.send(JSON.stringify({ type: 'leave' } satisfies ClientMessage));
      socket?.close();
      socket = null;
      handlers.status('offline', 0);
    },
    /** Skips the remaining backoff and reconnects now. */
    retryNow(): void {
      clearTimeout(timer);
      if (wanted && !socket) connect();
    },
  };
}

export type Client = ReturnType<typeof createClient>;
