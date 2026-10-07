import type { StrategyName } from '@roommix/core';
import type { RosterEntry } from '@roommix/server/protocol';
import type { InputKind } from './audio/capture.js';
import type { SavedRecording } from './audio/recordings.js';
import type { ConnectionStatus } from './client.js';
import type { NetworkSettings } from './net-sim.js';

export type MicStatus = 'off' | 'starting' | 'on' | 'paused';

export interface Notice {
  tone: 'info' | 'error';
  message: string;
  action?: { label: string; run: () => void };
}

export interface AppState {
  phase: 'lobby' | 'joined';
  room: string;
  name: string;
  clientId: string | null;
  connection: ConnectionStatus;
  mic: MicStatus;
  inputKind: InputKind;
  inputLevel: number;
  captureRate: number | null;
  roster: RosterEntry[];
  dominant: string | null;
  strategy: StrategyName;
  sequence: number;
  /** What the server's leveler is applying to the mix, in dB. */
  levelerDb: number;
  monitor: {
    playing: boolean;
    recording: boolean;
    outputLevel: number;
    bufferMs: number;
    underruns: number;
    /** Length of the recording in progress. */
    recordedMs: number;
    /** Saved in this browser, newest first; each carries an object URL for playback and download. */
    recordings: (SavedRecording & { url: string })[];
    /** Id of the saved recording playing back in the page, if any. */
    playingRecording: number | null;
    /** Level of that playback, so it can be watched like the live mix. */
    recordingLevel: number;
  };
  net: NetworkSettings;
  notice: Notice | null;
  /** Shows the analytics and test-only controls: input source, figures, strategy, network simulation. */
  advanced: boolean;
}

export const initialState: AppState = {
  phase: 'lobby',
  room: '',
  name: '',
  clientId: null,
  connection: 'offline',
  mic: 'off',
  inputKind: 'mic',
  inputLevel: 0,
  captureRate: null,
  roster: [],
  dominant: null,
  strategy: 'gain-sharing',
  sequence: 0,
  levelerDb: 0,
  monitor: {
    playing: false,
    recording: false,
    outputLevel: 0,
    bufferMs: 0,
    underruns: 0,
    recordedMs: 0,
    recordings: [],
    playingRecording: null,
    recordingLevel: 0,
  },
  net: { delayMs: 0, jitterMs: 0, dropPercent: 0 },
  notice: null,
  advanced: false,
};

/** Smallest possible store: one state object, shallow patches, listeners called after every change. */
export function createStore(initial: AppState) {
  let state = initial;
  const listeners = new Set<(state: AppState) => void>();
  return {
    get state(): AppState {
      return state;
    },
    update(patch: Partial<AppState> | ((state: AppState) => Partial<AppState>)): void {
      state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
      for (const listener of listeners) listener(state);
    },
    subscribe(listener: (state: AppState) => void): void {
      listeners.add(listener);
    },
  };
}

export type Store = ReturnType<typeof createStore>;
