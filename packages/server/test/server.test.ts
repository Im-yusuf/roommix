import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import type { ServerMessage } from '../src/protocol.js';
import { startServer } from '../src/server.js';

type Server = Awaited<ReturnType<typeof startServer>>;

function connect(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
  });
}

/** Collects everything a client receives, parsed. */
function inbox(socket: WebSocket) {
  const messages: ServerMessage[] = [];
  const frames: Buffer[] = [];
  socket.on('message', (data, isBinary) => {
    if (isBinary) frames.push(data as Buffer);
    else messages.push(JSON.parse(data.toString()) as ServerMessage);
  });
  return { messages, frames };
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

describe('server end to end', () => {
  let server: Server;
  beforeAll(async () => {
    server = await startServer({ port: 0, host: '127.0.0.1' });
  });
  afterAll(() => server.close());

  it('answers health checks and has no static files unless configured', async () => {
    const health = await fetch(`http://127.0.0.1:${server.port}/healthz`);
    expect(health.status).toBe(200);
    expect(await health.text()).toBe('ok');
    expect((await fetch(`http://127.0.0.1:${server.port}/health`)).status).toBe(200);
    expect((await fetch(`http://127.0.0.1:${server.port}/`)).status).toBe(404);
  });

  it('streams a mixed room to a subscriber over real sockets', async () => {
    const ann = await connect(server.port);
    const bob = await connect(server.port);
    const annIn = inbox(ann);
    const bobIn = inbox(bob);
    ann.send(JSON.stringify({ type: 'join', room: 'e2e', name: 'Ann' }));
    bob.send(JSON.stringify({ type: 'join', room: 'e2e', name: 'Bob' }));
    bob.send(JSON.stringify({ type: 'subscribe', enabled: true }));
    ann.send(JSON.stringify({ type: 'start', sampleRate: 48000 }));

    const chunk = new Int16Array(960); // 20 ms at 48 kHz
    for (let i = 0; i < chunk.length; i++)
      chunk[i] = Math.round(6000 * Math.sin((2 * Math.PI * 440 * i) / 48000));
    for (let i = 0; i < 25; i++) {
      ann.send(chunk);
      await sleep(20);
    }
    await sleep(150);

    expect(annIn.messages[0]).toMatchObject({ type: 'joined', room: 'e2e' });
    expect(bobIn.frames.length).toBeGreaterThan(10);
    expect(bobIn.frames.every((f) => f.byteLength === 640)).toBe(true);
    const roster = bobIn.messages.filter((m) => m.type === 'roster').at(-1);
    expect(roster?.participants.find((p) => p.name === 'Ann')).toMatchObject({ state: 'live' });
    expect(server.rooms.size).toBe(1);

    ann.close();
    bob.close();
    await sleep(50);
    expect(server.rooms.size).toBe(0);
  });
});
