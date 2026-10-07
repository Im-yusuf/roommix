import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';
import { wrapSocket } from '../src/websocket.js';

function fakeSocket() {
  const socket = Object.assign(new EventEmitter(), {
    OPEN: 1,
    readyState: 1,
    bufferedAmount: 0,
    ping: vi.fn(),
    terminate: vi.fn(),
    send: vi.fn(),
    close: vi.fn(),
  });
  return socket as unknown as WebSocket & typeof socket;
}

describe('websocket transport', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('terminates a peer that stops answering pings', () => {
    const socket = fakeSocket();
    wrapSocket(socket, 100);
    vi.advanceTimersByTime(100);
    expect(socket.ping).toHaveBeenCalledTimes(1);
    expect(socket.terminate).not.toHaveBeenCalled();
    socket.emit('pong');
    vi.advanceTimersByTime(100);
    expect(socket.terminate).not.toHaveBeenCalled(); // answered in time
    vi.advanceTimersByTime(100); // no pong this time
    expect(socket.terminate).toHaveBeenCalledTimes(1);
  });

  it('delivers text as strings and binary as byte views', () => {
    const socket = fakeSocket();
    const connection = wrapSocket(socket, 1000);
    const received: (string | Uint8Array)[] = [];
    connection.onMessage((data) => {
      received.push(data);
    });
    socket.emit('message', Buffer.from('{"type":"leave"}'), false);
    socket.emit('message', Buffer.from([1, 0, 2, 0]), true);
    expect(received[0]).toBe('{"type":"leave"}');
    expect(received[1]).toBeInstanceOf(Uint8Array);
    expect(Array.from(received[1] as Uint8Array)).toEqual([1, 0, 2, 0]);

    connection.send('hi');
    connection.send(new Uint8Array(2));
    expect(socket.send).toHaveBeenNthCalledWith(1, 'hi', { binary: false });
    expect(socket.send).toHaveBeenNthCalledWith(2, expect.any(Uint8Array), { binary: true });
    socket.emit('close');
    expect(vi.getTimerCount()).toBe(0);
  });
});
