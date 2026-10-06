import type { StrategyName } from '@roommix/core';
import type { RosterEntry } from '@roommix/server/protocol';
import type { InputKind } from './audio/capture.js';
import type { ConnectionStatus } from './client.js';

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
  monitor: {
    playing: boolean;
    recording: boolean;
    /** The finished recording is playing back in the page. */
    playingRecording: boolean;
    outputLevel: number;
    bufferMs: number;
    underruns: number;
    recordedMs: number;
    downloadUrl: string | null;
  };
  notice: Notice | null;
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
  monitor: {
    playing: false,
    recording: false,
    playingRecording: false,
    outputLevel: 0,
    bufferMs: 0,
    underruns: 0,
    recordedMs: 0,
    downloadUrl: null,
  },
  notice: null,
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
