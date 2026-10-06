import type { StrategyName } from '@roommix/core';
import type { RosterEntry } from '@roommix/server/protocol';
import type { ConnectionStatus } from './client.js';

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
  roster: RosterEntry[];
  dominant: string | null;
  strategy: StrategyName;
  sequence: number;
  notice: Notice | null;
}

export const initialState: AppState = {
  phase: 'lobby',
  room: '',
  name: '',
  clientId: null,
  connection: 'offline',
  roster: [],
  dominant: null,
  strategy: 'gain-sharing',
  sequence: 0,
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
