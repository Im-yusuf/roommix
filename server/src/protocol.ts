/**
 * Wire protocol between clients and the server, shared with the simulator.
 *
 * Text frames carry JSON control messages. Binary frames carry raw audio:
 * client to server, PCM16 little-endian at the rate given in `start`;
 * server to subscribers, 20 ms frames of 16 kHz mono PCM16 (640 bytes each).
 */
import type { SourceState, StrategyName } from '@roommix/core';

export const MAX_ROOM_SIZE = 8;
export const MAX_NAME_LENGTH = 32;
export const MAX_TEXT_MESSAGE_BYTES = 4096;
/** Frames are 640 bytes; a subscriber more than ~2 s behind starts skipping frames. */
export const MAX_SUBSCRIBER_BUFFERED_BYTES = 64 * 1024;
/** How often the roster (states, levels, gains, buffer depths) is pushed to everyone. */
export const ROSTER_INTERVAL_MS = 100;
/** The mixer clock is checked this often; it computes how many frames are owed itself. */
export const TICK_INTERVAL_MS = 10;
export const HEARTBEAT_MS = 5000;

export type ClientMessage =
  | { type: 'join'; room: string; name: string; clientId?: string }
  | { type: 'start'; sampleRate: number; channels?: number }
  | { type: 'stop' }
  | { type: 'subscribe'; enabled: boolean }
  | { type: 'strategy'; name: StrategyName }
  | { type: 'leave' };

export type RosterState = SourceState | 'idle';

export interface RosterEntry {
  clientId: string;
  name: string;
  /** `idle` means joined without sending audio. */
  state: RosterState;
  /** Smoothed RMS, 0..1 full scale. */
  level: number;
  /** Mix gain, 0..1. */
  gain: number;
  bufferMs: number;
  underruns: number;
  drops: number;
  /** Mixed frames this client missed because its connection was too slow. */
  skipped: number;
}

export type ErrorCode =
  | 'bad_message'
  | 'not_joined'
  | 'room_full'
  | 'replaced'
  | 'invalid_audio'
  | 'no_source';

export type ServerMessage =
  | { type: 'joined'; clientId: string; room: string; strategy: StrategyName }
  | {
      type: 'roster';
      participants: RosterEntry[];
      dominant: string | null;
      strategy: StrategyName;
      sequence: number;
      /** What the leveler is applying to the mix right now, in dB. */
      levelerDb: number;
    }
  | { type: 'error'; code: ErrorCode; message: string; fatal: boolean };

const ROOM_PATTERN = /^[\w.-]{1,32}$/;

/** Parses and validates a text frame. Returns a string describing the problem instead of a message. */
export function parseClientMessage(text: string): ClientMessage | string {
  if (text.length > MAX_TEXT_MESSAGE_BYTES) return 'message too long';
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return 'not valid JSON';
  }
  if (typeof raw !== 'object' || raw === null) return 'message must be an object';
  const message = raw as Record<string, unknown>;
  switch (message.type) {
    case 'join': {
      if (typeof message.room !== 'string' || !ROOM_PATTERN.test(message.room)) {
        return 'room must be 1-32 letters, digits, dot, dash or underscore';
      }
      if (
        typeof message.name !== 'string' ||
        message.name.trim().length === 0 ||
        message.name.length > MAX_NAME_LENGTH
      ) {
        return `name must be 1-${MAX_NAME_LENGTH} characters`;
      }
      if (
        message.clientId !== undefined &&
        (typeof message.clientId !== 'string' || message.clientId.length > 64)
      ) {
        return 'clientId must be a short string';
      }
      return {
        type: 'join',
        room: message.room,
        name: message.name.trim(),
        clientId: message.clientId,
      };
    }
    case 'start': {
      if (typeof message.sampleRate !== 'number' || !Number.isFinite(message.sampleRate)) {
        return 'sampleRate must be a finite number';
      }
      if (message.channels !== undefined && message.channels !== 1 && message.channels !== 2) {
        return 'channels must be 1 or 2';
      }
      return { type: 'start', sampleRate: message.sampleRate, channels: message.channels };
    }
    case 'stop':
    case 'leave':
      return { type: message.type };
    case 'subscribe':
      if (typeof message.enabled !== 'boolean') return 'enabled must be a boolean';
      return { type: 'subscribe', enabled: message.enabled };
    case 'strategy':
      if (message.name !== 'gain-sharing' && message.name !== 'plain-sum')
        return 'unknown strategy';
      return { type: 'strategy', name: message.name };
    default:
      return `unknown message type ${JSON.stringify(message.type)}`;
  }
}
