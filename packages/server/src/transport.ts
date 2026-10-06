/**
 * The room logic talks to clients only through this interface, so a WebRTC
 * data channel (or a test double) can replace WebSocket without touching rooms.
 * Liveness is the transport's job: a connection that stops answering simply closes.
 */
export interface Connection {
  send(data: string | Uint8Array): void;
  close(reason?: string): void;
  /** Bytes queued but not yet handed to the network; a slow reader lets this grow. */
  readonly bufferedBytes: number;
  onMessage(handler: (data: string | Uint8Array) => void): void;
  onClose(handler: () => void): void;
}

export interface Transport {
  onConnection(handler: (connection: Connection) => void): void;
}
