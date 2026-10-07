import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRooms, type Rooms } from '../src/rooms.js';
import { attachSession } from '../src/session.js';
import { createFakeConnection, type FakeConnection } from './fake-connection.js';

/** 20 ms of a 440 Hz tone at 16 kHz, as the bytes a client would send. */
function toneChunk(frame: number): Uint8Array {
  const pcm = new Int16Array(320);
  for (let i = 0; i < pcm.length; i++) {
    pcm[i] = Math.round(8000 * Math.sin((2 * Math.PI * 440 * (frame * 320 + i)) / 16000));
  }
  return new Uint8Array(pcm.buffer);
}

describe('rooms and sessions', () => {
  let rooms: Rooms;
  let clock = 0;

  /** Advances the fake clock and timers in 10 ms steps so the room's tick interval runs realistically. */
  const advance = (ms: number) => {
    for (let t = 0; t < ms; t += 10) {
      clock += 10;
      vi.advanceTimersByTime(10);
    }
  };
  const connect = (room = 'r1', name = 'Ann', clientId?: string): FakeConnection => {
    const connection = createFakeConnection();
    attachSession(connection, rooms);
    connection.receive({ type: 'join', room, name, clientId });
    return connection;
  };
  /** Streams audio for `ms` as a live client would: one chunk per 20 ms, between ticks. */
  const stream = (connection: FakeConnection, ms: number, from = 0) => {
    for (let i = 0; i < ms / 20; i++) {
      connection.receive(toneChunk(from + i));
      advance(20);
    }
  };

  beforeEach(() => {
    vi.useFakeTimers();
    clock = 0;
    rooms = createRooms({ now: () => clock, maxRoomSize: 2 });
  });
  afterEach(() => {
    rooms.disposeAll();
    vi.useRealTimers();
  });

  it('acknowledges a join and lists the participant as idle', () => {
    const ann = connect();
    expect(ann.messages()[0]).toMatchObject({
      type: 'joined',
      room: 'r1',
      strategy: 'gain-sharing',
    });
    advance(100);
    expect(ann.lastRoster()?.participants).toEqual([
      expect.objectContaining({ name: 'Ann', state: 'idle', level: 0 }),
    ]);
    expect(rooms.size).toBe(1);
  });

  it('mixes a source and fans the stream out to subscribers only', () => {
    const ann = connect('r1', 'Ann');
    const bob = connect('r1', 'Bob');
    bob.receive({ type: 'subscribe', enabled: true });
    ann.receive({ type: 'start', sampleRate: 16000 });
    stream(ann, 500);

    const frames = bob.binary();
    expect(frames.length).toBeGreaterThan(15);
    expect(frames.every((f) => f.byteLength === 640)).toBe(true);
    expect(ann.binary()).toEqual([]); // Ann did not subscribe

    const annEntry = bob.lastRoster()?.participants.find((p) => p.name === 'Ann');
    expect(annEntry).toMatchObject({ state: 'live', underruns: 0, drops: 0 });
    expect(annEntry?.level).toBeGreaterThan(0.1);
    expect(annEntry?.gain).toBeGreaterThan(0.9);
    expect(annEntry?.bufferMs).toBeGreaterThanOrEqual(40);
    expect(bob.lastRoster()?.dominant).toBe(annEntry?.clientId);
  });

  it('refuses a join beyond the room size', () => {
    connect('r1', 'Ann');
    connect('r1', 'Bob');
    const cat = connect('r1', 'Cat');
    expect(cat.errors()).toEqual([expect.objectContaining({ code: 'room_full', fatal: true })]);
    expect(cat.closed).toBe(true);
    expect(rooms.get('r1')?.size).toBe(2);
  });

  it('replaces the earlier connection when the same client id reconnects', () => {
    const first = connect('r1', 'Ann', 'ann-id');
    first.receive({ type: 'start', sampleRate: 16000 });
    stream(first, 100);
    const second = connect('r1', 'Ann', 'ann-id');

    expect(first.errors()).toEqual([expect.objectContaining({ code: 'replaced', fatal: true })]);
    expect(first.closed).toBe(true);
    expect(rooms.get('r1')?.size).toBe(1); // the old socket closing did not evict the new one
    second.receive({ type: 'start', sampleRate: 16000 });
    stream(second, 100);
    expect(second.lastRoster()?.participants).toEqual([
      expect.objectContaining({ clientId: 'ann-id', state: 'live' }),
    ]);
  });

  it('answers malformed traffic with error messages and stays up', () => {
    const stranger = createFakeConnection();
    attachSession(stranger, rooms);
    stranger.receive(new Uint8Array(640));
    stranger.receive('not json');
    stranger.receive({ type: 'dance' });
    stranger.receive({ type: 'join', room: 'bad room!', name: 'x' });
    expect(stranger.errors().map((e) => e.code)).toEqual([
      'not_joined',
      'bad_message',
      'bad_message',
      'bad_message',
    ]);

    const ann = connect();
    ann.receive(new Uint8Array(640)); // audio before start
    ann.receive({ type: 'start', sampleRate: Number.NaN });
    ann.receive({ type: 'start', sampleRate: 1000 });
    ann.receive({ type: 'start', sampleRate: 16000 });
    ann.receive(new Uint8Array(641)); // odd byte length
    ann.receive(new Uint8Array(16000 * 2 * 2)); // 2 s, over the chunk limit
    expect(ann.errors().map((e) => e.code)).toEqual([
      'no_source',
      'bad_message',
      'invalid_audio',
      'invalid_audio',
      'invalid_audio',
    ]);
    expect(ann.closed).toBe(false);
    stream(ann, 100);
    expect(ann.lastRoster()?.participants[0]?.state).toBe('live');
  });

  it('skips frames for a slow subscriber instead of holding up the mixer', () => {
    const ann = connect('r1', 'Ann');
    const bob = connect('r1', 'Bob');
    bob.receive({ type: 'subscribe', enabled: true });
    ann.receive({ type: 'start', sampleRate: 16000 });
    stream(ann, 200);
    const delivered = bob.binary().length;
    expect(delivered).toBeGreaterThan(0);

    bob.bufferedBytes = 10 * 1024 * 1024; // the socket is backed up
    stream(ann, 200, 10);
    expect(bob.binary().length).toBe(delivered);
    const skipped = bob.lastRoster()?.participants.find((p) => p.name === 'Bob')?.skipped ?? 0;
    expect(skipped).toBeGreaterThan(5);

    bob.bufferedBytes = 0;
    stream(ann, 200, 20);
    expect(bob.binary().length).toBeGreaterThan(delivered);
  });

  it('switches strategy for the whole room', () => {
    const ann = connect('r1', 'Ann');
    const bob = connect('r1', 'Bob');
    ann.receive({ type: 'strategy', name: 'plain-sum' });
    advance(100);
    expect(bob.lastRoster()?.strategy).toBe('plain-sum');
    expect(rooms.get('r1')?.strategy).toBe('plain-sum');
  });

  it('tears the room down when the last participant leaves or drops', () => {
    const ann = connect('r1', 'Ann');
    const bob = connect('r1', 'Bob');
    ann.receive({ type: 'start', sampleRate: 16000 });
    stream(ann, 100);
    ann.receive({ type: 'leave' });
    expect(ann.closed).toBe(true);
    expect(ann.closeReason).toBe('left');
    advance(100);
    expect(bob.lastRoster()?.participants.map((p) => p.name)).toEqual(['Bob']);

    bob.drop(); // tab closed without leaving
    expect(rooms.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0); // the room's intervals are gone
  });
});
