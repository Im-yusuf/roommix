import type { ServerMessage } from '@roommix/server/protocol';
import { type Capture, type InputKind, startCapture } from './audio/capture.js';
import { createClient } from './client.js';
import type { Notice, Store } from './state.js';

const RECONNECT_PREFIX = 'Connection lost.';

/** Everything the page can do, as actions over the store. Rendering is someone else's job. */
export function createApp(store: Store) {
  /** True once this connection has joined and announced its source; audio before that would be rejected. */
  let audioReady = false;
  const client = createClient(wsUrl(), {
    status: onStatus,
    message: onMessage,
    frame: () => {}, // the mixed stream is not consumed until the monitor exists
  });

  let capture: Capture | null = null;

  const notify = (notice: Notice | null) => store.update({ notice });
  const storageKey = (room: string) => `roommix:${room}`;

  function onStatus(status: typeof store.state.connection, attempt: number): void {
    store.update({ connection: status });
    if (status === 'reconnecting') {
      audioReady = false;
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
        // After a reconnect the server has a fresh participant: tell it what this tab was doing.
        if (capture) {
          client.send({ type: 'start', sampleRate: capture.sampleRate });
          audioReady = true;
        }
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
      void leave();
      notify({ tone: 'error', message: `${message}. Try another room name.` });
    } else if (code === 'replaced') {
      const { room, name } = store.state;
      void leave();
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

  async function leave(): Promise<void> {
    await stopInput(false);
    client.leave();
    store.update({ phase: 'lobby', roster: [], dominant: null, clientId: null, notice: null });
  }

  async function startInput(): Promise<void> {
    if (capture) return;
    store.update({ mic: 'starting', notice: null });
    try {
      capture = await startCapture(store.state.inputKind, {
        chunk: (pcm) => {
          if (audioReady) client.sendAudio(pcm);
        },
        level: (rms) => store.update({ inputLevel: rms }),
        paused: (reason) => {
          store.update({ mic: 'paused' });
          notify({ tone: 'info', message: reason });
        },
        resumed: () => {
          if (store.state.mic !== 'paused') return;
          store.update({ mic: 'on' });
          notify(null);
        },
      });
      store.update({ mic: 'on', captureRate: capture.sampleRate });
      client.send({ type: 'start', sampleRate: capture.sampleRate });
      audioReady = true;
    } catch (error) {
      capture = null;
      store.update({ mic: 'off' });
      notify({
        tone: 'error',
        message: error instanceof Error ? error.message : String(error),
        action: { label: 'Try again', run: () => void startInput() },
      });
    }
  }

  async function stopInput(tellServer = true): Promise<void> {
    if (!capture) return;
    audioReady = false;
    if (tellServer) client.send({ type: 'stop' });
    const current = capture;
    capture = null;
    await current.stop();
    store.update({ mic: 'off', inputLevel: 0, captureRate: null });
  }

  function setInputKind(kind: InputKind): void {
    const wasOn = capture !== null;
    store.update({ inputKind: kind });
    if (wasOn) void stopInput().then(startInput);
  }

  return {
    join,
    leave,
    toggleInput: () => (capture ? stopInput() : startInput()),
    setInputKind,
    dismissNotice: () => notify(null),
  };
}

function wsUrl(): string {
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
}
