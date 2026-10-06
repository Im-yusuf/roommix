import type { ServerMessage } from '@roommix/server/protocol';
import { createClient } from './client.js';
import type { Notice, Store } from './state.js';

const RECONNECT_PREFIX = 'Connection lost.';

/** Everything the page can do, as actions over the store. Rendering is someone else's job. */
export function createApp(store: Store) {
  const client = createClient(wsUrl(), {
    status: onStatus,
    message: onMessage,
    frame: () => {}, // the mixed stream is not consumed until the monitor exists
  });

  const notify = (notice: Notice | null) => store.update({ notice });
  const storageKey = (room: string) => `roommix:${room}`;

  function onStatus(status: typeof store.state.connection, attempt: number): void {
    store.update({ connection: status });
    if (status === 'reconnecting') {
      notify({
        tone: 'info',
        message: `${RECONNECT_PREFIX} Reconnecting (attempt ${attempt})…`,
        action: { label: 'Retry now', run: () => client.retryNow() },
      });
    } else if (status === 'connected' && store.state.notice?.message.startsWith(RECONNECT_PREFIX)) {
      notify(null);
    }
  }

  function onMessage(message: ServerMessage): void {
    switch (message.type) {
      case 'joined':
        sessionStorage.setItem(storageKey(message.room), message.clientId);
        client.rememberClientId(message.clientId);
        store.update({ clientId: message.clientId, strategy: message.strategy });
        return;
      case 'roster':
        store.update({
          roster: message.participants,
          dominant: message.dominant,
          strategy: message.strategy,
          sequence: message.sequence,
        });
        return;
      case 'error':
        onServerError(message.code, message.message);
        return;
    }
  }

  function onServerError(code: string, message: string): void {
    if (code === 'room_full') {
      leave();
      notify({ tone: 'error', message: `${message}. Try another room name.` });
    } else if (code === 'replaced') {
      const { room, name } = store.state;
      leave();
      notify({
        tone: 'error',
        message: 'You joined from another tab or device, so this one was disconnected.',
        action: { label: 'Rejoin here', run: () => join(room, name) },
      });
    } else {
      notify({ tone: 'error', message });
    }
  }

  function join(room: string, name: string): void {
    store.update({ phase: 'joined', room, name, notice: null, roster: [], dominant: null });
    client.join({
      type: 'join',
      room,
      name,
      clientId: sessionStorage.getItem(storageKey(room)) ?? undefined,
    });
  }

  function leave(): void {
    client.leave();
    store.update({ phase: 'lobby', roster: [], dominant: null, clientId: null, notice: null });
  }

  return { join, leave, dismissNotice: () => notify(null) };
}

function wsUrl(): string {
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
}
