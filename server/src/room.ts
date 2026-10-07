import { createMixer, type StrategyName } from '@roommix/core';
import {
  MAX_ROOM_SIZE,
  MAX_SUBSCRIBER_BUFFERED_BYTES,
  ROSTER_INTERVAL_MS,
  type RosterEntry,
  type ServerMessage,
  TICK_INTERVAL_MS,
} from './protocol.js';
import type { Connection } from './transport.js';

export interface RoomOptions {
  maxParticipants?: number;
  /** Monotonic clock in ms; injectable for tests. */
  now?: () => number;
  /** Called when the last participant has gone; the owner should dispose the room. */
  onEmpty?: () => void;
}

interface Participant {
  clientId: string;
  name: string;
  connection: Connection;
  hasSource: boolean;
  subscribed: boolean;
  skipped: number;
}

/**
 * One mixer, its participants, and the fan-out of the mixed stream. The room
 * knows nothing about parsing messages; sessions call its methods.
 */
export function createRoom(name: string, options: RoomOptions = {}) {
  const mixer = createMixer();
  const participants = new Map<string, Participant>();
  const now = options.now ?? (() => performance.now());
  const maxParticipants = options.maxParticipants ?? MAX_ROOM_SIZE;
  let dominant: string | null = null;
  let sequence = 0;

  mixer.on('frame', (frame) => {
    dominant = frame.dominant;
    sequence = frame.sequence;
    const bytes = new Uint8Array(frame.pcm.buffer, frame.pcm.byteOffset, frame.pcm.byteLength);
    for (const participant of participants.values()) {
      if (!participant.subscribed) continue;
      // A slow reader never holds the mixer up: it just misses frames.
      if (participant.connection.bufferedBytes > MAX_SUBSCRIBER_BUFFERED_BYTES) {
        participant.skipped++;
        continue;
      }
      participant.connection.send(bytes);
    }
  });

  // The interval only wakes the mixer; the mixer works out how many frames are owed.
  const ticker = setInterval(() => mixer.tick(now()), TICK_INTERVAL_MS);
  // Joins, leaves and strategy changes show up in the next roster; nothing is broadcast ad hoc,
  // so a client's first message is always its own `joined`.
  const rosterTimer = setInterval(() => {
    const text = JSON.stringify(roster());
    for (const participant of participants.values()) participant.connection.send(text);
  }, ROSTER_INTERVAL_MS);

  function send(participant: Participant, message: ServerMessage): void {
    participant.connection.send(JSON.stringify(message));
  }

  function roster(): ServerMessage {
    const stats = new Map(mixer.stats().map((s) => [s.id, s]));
    const entries: RosterEntry[] = [...participants.values()].map((p) => {
      const s = stats.get(p.clientId);
      return {
        clientId: p.clientId,
        name: p.name,
        state: p.hasSource ? (s?.state ?? 'joining') : 'idle',
        level: s?.level ?? 0,
        gain: s?.gain ?? 0,
        bufferMs: s?.bufferMs ?? 0,
        underruns: s?.underruns ?? 0,
        drops: s?.drops ?? 0,
        skipped: p.skipped,
      };
    });
    return { type: 'roster', participants: entries, dominant, strategy: mixer.strategy, sequence };
  }

  function getParticipant(clientId: string): Participant {
    const participant = participants.get(clientId);
    if (!participant) throw new Error(`No participant "${clientId}" in room "${name}"`);
    return participant;
  }

  function detach(participant: Participant): void {
    if (participant.hasSource) mixer.removeSource(participant.clientId);
    participants.delete(participant.clientId);
  }

  return {
    name,

    get size(): number {
      return participants.size;
    },

    get strategy(): StrategyName {
      return mixer.strategy;
    },

    /** Adds a participant. A reconnect with the same clientId replaces the earlier connection. */
    add(
      connection: Connection,
      displayName: string,
      clientId: string,
    ): { ok: true } | { ok: false; reason: 'room_full' } {
      const existing = participants.get(clientId);
      if (existing) {
        send(existing, {
          type: 'error',
          code: 'replaced',
          message: 'You reconnected from elsewhere',
          fatal: true,
        });
        detach(existing);
        existing.connection.close('replaced');
      } else if (participants.size >= maxParticipants) {
        return { ok: false, reason: 'room_full' };
      }
      participants.set(clientId, {
        clientId,
        name: displayName,
        connection,
        hasSource: false,
        subscribed: false,
        skipped: 0,
      });
      return { ok: true };
    },

    /** Removes a participant, but only if `connection` is still the one it joined with. */
    remove(clientId: string, connection: Connection): void {
      const participant = participants.get(clientId);
      if (!participant || participant.connection !== connection) return;
      detach(participant);
      if (participants.size === 0) options.onEmpty?.();
    },

    /** Begins (or restarts) this participant's audio. Throws MixerError for a bad sample rate. */
    startSource(clientId: string, sampleRate: number, channels?: number): void {
      const participant = getParticipant(clientId);
      if (participant.hasSource) mixer.removeSource(clientId);
      participant.hasSource = false;
      mixer.addSource(clientId, { sampleRate, channels });
      participant.hasSource = true;
    },

    stopSource(clientId: string): void {
      const participant = getParticipant(clientId);
      if (!participant.hasSource) return;
      mixer.removeSource(clientId);
      participant.hasSource = false;
    },

    /** Throws MixerError for malformed audio or when no source was started. */
    pushAudio(clientId: string, bytes: Uint8Array): void {
      mixer.push(clientId, bytes);
    },

    subscribe(clientId: string, enabled: boolean): void {
      getParticipant(clientId).subscribed = enabled;
    },

    setStrategy(strategy: StrategyName): void {
      mixer.setStrategy(strategy);
    },

    dispose(): void {
      clearInterval(ticker);
      clearInterval(rosterTimer);
    },
  };
}

export type Room = ReturnType<typeof createRoom>;
