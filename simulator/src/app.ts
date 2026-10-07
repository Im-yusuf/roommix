import type { StrategyName } from '@roommix/core';
import type { ServerMessage } from '@roommix/server/protocol';
import { type Capture, CaptureError, type InputKind, startCapture } from './audio/capture.js';
import { type Playback, startPlayback } from './audio/playback.js';
import { createRecorder } from './audio/recorder.js';
import {
  deleteRecording as deleteStored,
  listRecordings,
  type StoredRecording,
  saveRecording,
} from './audio/recordings.js';
import { createClient } from './client.js';
import { createNetworkSimulator, type NetworkSettings } from './net-sim.js';
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

  // Chunks the simulator held back must not arrive after the source stopped: the server would reject them.
  const net = createNetworkSimulator((pcm) => {
    if (audioReady) client.sendAudio(pcm);
  });
  let capture: Capture | null = null;
  let playback: Playback | null = null;
  const recorder = createRecorder();
  const recordingPlayer = new Audio();
  recordingPlayer.addEventListener('ended', () => stopRecordingPlayback());
  let lastRecordedUpdate = 0;
  /** Playback runs through an analyser so the page can meter it like the live mix. */
  let playbackMeter: {
    context: AudioContext;
    analyser: AnalyserNode;
    samples: Float32Array<ArrayBuffer>;
  } | null = null;
  let meterTimer: ReturnType<typeof setInterval> | null = null;
  /** True when IndexedDB refused; recordings then last only until the page is closed. */
  let storageUnavailable = false;

  const describeRecording = (stored: StoredRecording) => {
    const { blob, ...recording } = stored;
    return { ...recording, url: URL.createObjectURL(blob) };
  };

  void listRecordings()
    .then((stored) => {
      store.update((st) => ({
        monitor: { ...st.monitor, recordings: stored.map(describeRecording) },
      }));
    })
    .catch(() => {
      storageUnavailable = true;
    });

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
    // Fatal errors send the page back to the lobby; the notice is set after
    // leave() resolves, because leaving clears whatever notice was showing.
    if (code === 'room_full') {
      void leave().then(() =>
        notify({ tone: 'error', message: `${message}. Try another room name.` }),
      );
    } else if (code === 'replaced') {
      const { room, name } = store.state;
      void leave().then(() =>
        notify({
          tone: 'error',
          message: 'You joined from another tab or device, so this one was disconnected.',
          action: { label: 'Rejoin here', run: () => join(room, name) },
        }),
      );
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
          if (audioReady) net.push(pcm);
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
      store.update({ monitor: { ...monitor, recording: false, recordedMs: recorder.durationMs } });
      void keepRecording();
    } else {
      stopRecordingPlayback();
      recorder.clear();
      store.update((st) => ({ monitor: { ...st.monitor, recording: true, recordedMs: 0 } }));
    }
    syncSubscription();
  }

  /** The stopped recording goes into the browser's storage and to the top of the list. */
  async function keepRecording(): Promise<void> {
    if (recorder.durationMs === 0) return;
    const blob = recorder.toBlob();
    const draft = {
      name: `${store.state.room || 'mix'} · ${new Date().toLocaleTimeString()}`,
      createdAt: Date.now(),
      durationMs: recorder.durationMs,
      bytes: blob.size,
      blob,
    };
    let stored: StoredRecording;
    try {
      stored = await saveRecording(draft);
    } catch {
      // No IndexedDB (private browsing, old browser): keep it for this page's lifetime.
      stored = { ...draft, id: -Date.now() };
      if (!storageUnavailable) {
        storageUnavailable = true;
        notify({
          tone: 'info',
          message: 'This browser cannot store recordings; this one lasts until the page is closed.',
        });
      }
    }
    store.update((st) => ({
      monitor: { ...st.monitor, recordings: [describeRecording(stored), ...st.monitor.recordings] },
    }));
  }

  function playRecording(id: number): void {
    const { monitor } = store.state;
    if (monitor.playingRecording === id) {
      stopRecordingPlayback();
      return;
    }
    const recording = monitor.recordings.find((r) => r.id === id);
    if (!recording) return;
    stopRecordingPlayback();
    if (!playbackMeter) {
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      context.createMediaElementSource(recordingPlayer).connect(analyser);
      analyser.connect(context.destination);
      playbackMeter = { context, analyser, samples: new Float32Array(analyser.fftSize) };
    }
    void playbackMeter.context.resume();
    recordingPlayer.src = recording.url;
    void recordingPlayer.play();
    store.update({ monitor: { ...monitor, playingRecording: id, recordingLevel: 0 } });
    meterTimer = setInterval(() => {
      if (!playbackMeter) return;
      playbackMeter.analyser.getFloatTimeDomainData(playbackMeter.samples);
      let sum = 0;
      for (const sample of playbackMeter.samples) sum += sample * sample;
      const rms = Math.sqrt(sum / playbackMeter.samples.length);
      store.update((st) => ({ monitor: { ...st.monitor, recordingLevel: rms } }));
    }, 50);
  }

  function stopRecordingPlayback(): void {
    recordingPlayer.pause();
    recordingPlayer.currentTime = 0;
    if (meterTimer !== null) {
      clearInterval(meterTimer);
      meterTimer = null;
    }
    if (store.state.monitor.playingRecording !== null) {
      store.update((st) => ({
        monitor: { ...st.monitor, playingRecording: null, recordingLevel: 0 },
      }));
    }
  }

  function deleteRecording(id: number): void {
    const { monitor } = store.state;
    const recording = monitor.recordings.find((r) => r.id === id);
    if (!recording) return;
    if (monitor.playingRecording === id) stopRecordingPlayback();
    URL.revokeObjectURL(recording.url);
    store.update((st) => ({
      monitor: { ...st.monitor, recordings: st.monitor.recordings.filter((r) => r.id !== id) },
    }));
    if (id > 0) void deleteStored(id).catch(() => undefined);
  }

  function setStrategy(name: StrategyName): void {
    client.send({ type: 'strategy', name });
    store.update({ strategy: name });
  }

  function setNetwork(changes: Partial<NetworkSettings>): void {
    net.configure(changes);
    store.update({ net: net.settings });
  }

  function setAdvanced(on: boolean): void {
    localStorage.setItem('roommix:advanced', on ? '1' : '0');
    store.update({ advanced: on });
    if (on) return;
    // Leaving the advanced view puts every setting it hides back to its default,
    // so nothing keeps acting on the session out of sight.
    if (store.state.phase === 'joined' && store.state.strategy !== 'gain-sharing')
      setStrategy('gain-sharing');
    const { delayMs, jitterMs, dropPercent } = store.state.net;
    if (delayMs || jitterMs || dropPercent) setNetwork({ delayMs: 0, jitterMs: 0, dropPercent: 0 });
    if (capture === null && store.state.inputKind !== 'mic') store.update({ inputKind: 'mic' });
  }

  return {
    join,
    leave,
    toggleInput: () => (capture ? stopInput() : startInput()),
    setInputKind,
    togglePlayback,
    toggleRecording,
    playRecording,
    deleteRecording,
    setStrategy,
    setNetwork,
    setAdvanced,
    dismissNotice: () => notify(null),
  };
}

function wsUrl(): string {
  // Same origin by default; a static host (Firebase Hosting) points at the Cloud Run server instead.
  const configured = import.meta.env.VITE_WS_URL as string | undefined;
  if (configured) return configured;
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
}
