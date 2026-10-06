import type { StrategyName } from '@roommix/core';
import type { ServerMessage } from '@roommix/server/protocol';
import { type Capture, CaptureError, type InputKind, startCapture } from './audio/capture.js';
import { type Playback, startPlayback } from './audio/playback.js';
import { createRecorder } from './audio/recorder.js';
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
    frame: onFrame,
  });

  let capture: Capture | null = null;
  let playback: Playback | null = null;
  const recorder = createRecorder();
  const recordingPlayer = new Audio();
  recordingPlayer.addEventListener('ended', () => {
    store.update((st) => ({ monitor: { ...st.monitor, playingRecording: false } }));
  });
  let lastRecordedUpdate = 0;

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
        syncSubscription();
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

  function onFrame(pcm: Int16Array): void {
    playback?.push(pcm);
    if (!store.state.monitor.recording) return;
    recorder.push(pcm);
    const now = performance.now();
    if (now - lastRecordedUpdate > 250) {
      lastRecordedUpdate = now;
      store.update((s) => ({ monitor: { ...s.monitor, recordedMs: recorder.durationMs } }));
    }
  }

  function syncSubscription(): void {
    const { playing, recording } = store.state.monitor;
    client.send({ type: 'subscribe', enabled: playing || recording });
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
    stopRecordingPlayback();
    await stopInput(false);
    await stopPlayback();
    client.leave();
    store.update((s) => ({
      phase: 'lobby',
      roster: [],
      dominant: null,
      clientId: null,
      notice: null,
      monitor: { ...s.monitor, recording: false },
    }));
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
        ended: (reason) => {
          void stopInput();
          notify({
            tone: 'error',
            message: reason,
            action: { label: 'Try again', run: () => void startInput() },
          });
        },
      });
      store.update({ mic: 'on', captureRate: capture.sampleRate });
      client.send({ type: 'start', sampleRate: capture.sampleRate });
      audioReady = true;
    } catch (error) {
      capture = null;
      store.update({ mic: 'off' });
      const retryable = !(error instanceof CaptureError) || error.retryable;
      notify({
        tone: 'error',
        message: error instanceof Error ? error.message : String(error),
        action: retryable
          ? { label: 'Try again', run: () => void startInput() }
          : {
              label: 'Use audio file A instead',
              run: () => {
                setInputKind('fileA');
                void startInput();
              },
            },
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

  async function togglePlayback(): Promise<void> {
    if (playback) {
      await stopPlayback();
    } else {
      try {
        playback = await startPlayback((stats) =>
          store.update((s) => ({
            monitor: {
              ...s.monitor,
              outputLevel: stats.rms,
              bufferMs: stats.bufferMs,
              underruns: stats.underruns,
            },
          })),
        );
        store.update((s) => ({ monitor: { ...s.monitor, playing: true } }));
      } catch (error) {
        notify({
          tone: 'error',
          message: `Playback could not start: ${error instanceof Error ? error.message : error}`,
        });
      }
    }
    syncSubscription();
  }

  async function stopPlayback(): Promise<void> {
    if (!playback) return;
    const current = playback;
    playback = null;
    await current.stop();
    store.update((s) => ({
      monitor: { ...s.monitor, playing: false, outputLevel: 0, bufferMs: 0 },
    }));
  }

  function toggleRecording(): void {
    const { monitor } = store.state;
    if (monitor.recording) {
      if (monitor.downloadUrl) URL.revokeObjectURL(monitor.downloadUrl);
      const downloadUrl = URL.createObjectURL(recorder.toBlob());
      store.update({
        monitor: { ...monitor, recording: false, recordedMs: recorder.durationMs, downloadUrl },
      });
    } else {
      stopRecordingPlayback();
      recorder.clear();
      store.update((st) => ({
        monitor: { ...st.monitor, recording: true, recordedMs: 0, downloadUrl: null },
      }));
    }
    syncSubscription();
  }

  function toggleRecordingPlayback(): void {
    const { monitor } = store.state;
    if (monitor.playingRecording) {
      stopRecordingPlayback();
      return;
    }
    if (!monitor.downloadUrl) return;
    if (recordingPlayer.src !== monitor.downloadUrl) recordingPlayer.src = monitor.downloadUrl;
    void recordingPlayer.play();
    store.update({ monitor: { ...monitor, playingRecording: true } });
  }

  function stopRecordingPlayback(): void {
    recordingPlayer.pause();
    recordingPlayer.currentTime = 0;
    if (store.state.monitor.playingRecording) {
      store.update((st) => ({ monitor: { ...st.monitor, playingRecording: false } }));
    }
  }

  function setStrategy(name: StrategyName): void {
    client.send({ type: 'strategy', name });
    store.update({ strategy: name });
  }

  return {
    join,
    leave,
    toggleInput: () => (capture ? stopInput() : startInput()),
    setInputKind,
    togglePlayback,
    toggleRecording,
    toggleRecordingPlayback,
    setStrategy,
    dismissNotice: () => notify(null),
  };
}

function wsUrl(): string {
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
}
