import type { ServerMessage } from '../src/protocol.js';
import type { Connection } from '../src/transport.js';

/** In-memory stand-in for a socket: records what the server sends and lets a test inject client traffic. */
export function createFakeConnection() {
  const sent: (string | Uint8Array)[] = [];
  let messageHandler: ((data: string | Uint8Array) => void) | undefined;
  let closeHandler: (() => void) | undefined;

  const connection = {
    sent,
    bufferedBytes: 0,
    closed: false,
    closeReason: undefined as string | undefined,

    send(data: string | Uint8Array) {
      sent.push(data);
    },
    close(reason?: string) {
      if (connection.closed) return;
      connection.closed = true;
      connection.closeReason = reason;
      closeHandler?.();
    },
    onMessage(handler: (data: string | Uint8Array) => void) {
      messageHandler = handler;
    },
    onClose(handler: () => void) {
      closeHandler = handler;
    },

    /** Client-side traffic: objects are sent as JSON text, bytes as a binary frame. */
    receive(data: string | Uint8Array | object) {
      const payload =
        typeof data === 'string' || data instanceof Uint8Array ? data : JSON.stringify(data);
      messageHandler?.(payload);
    },
    /** The socket dropping without a leave message. */
    drop() {
      connection.close();
    },
    messages(): ServerMessage[] {
      return sent
        .filter((d): d is string => typeof d === 'string')
        .map((d) => JSON.parse(d) as ServerMessage);
    },
    binary(): Uint8Array[] {
      return sent.filter((d): d is Uint8Array => d instanceof Uint8Array);
    },
    lastRoster() {
      const rosters = connection.messages().filter((m) => m.type === 'roster');
      return rosters.at(-1);
    },
    errors() {
      return connection.messages().filter((m) => m.type === 'error');
    },
  } satisfies Connection & Record<string, unknown>;

  return connection;
}

export type FakeConnection = ReturnType<typeof createFakeConnection>;
