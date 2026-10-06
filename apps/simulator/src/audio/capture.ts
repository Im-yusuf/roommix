import deviceAUrl from '../../../../fixtures/deviceA.wav?url';
import deviceBUrl from '../../../../fixtures/deviceB.wav?url';
import captureWorkletUrl from './worklets/capture-processor.ts?worker&url';

export type InputKind = 'mic' | 'fileA' | 'fileB';

export interface CaptureHandlers {
  chunk(pcm: Int16Array): void;
  level(rms: number): void;
  paused(reason: string): void;
  resumed(): void;
  ended(reason: string): void;
}

export interface Capture {
  /** The rate the browser actually gave us; sent to the server, which resamples. */
  sampleRate: number;
  stop(): Promise<void>;
}

export class CaptureError extends Error {
  constructor(
    message: string,
    /** False when retrying cannot help (no secure context, no getUserMedia). */
    readonly retryable = true,
  ) {
    super(message);
  }
}

const FILE_URLS: Record<Exclude<InputKind, 'mic'>, string> = {
  fileA: deviceAUrl,
  fileB: deviceBUrl,
};

/**
 * Captures the microphone, or a looping fixture file standing in for one,
 * through an AudioWorklet that produces 20 ms PCM16 chunks. Must be called
 * from a user gesture so the AudioContext may start.
 */
export async function startCapture(kind: InputKind, handlers: CaptureHandlers): Promise<Capture> {
  const context = new AudioContext();
  const cleanups: (() => void)[] = [];
  try {
    await context.audioWorklet.addModule(captureWorkletUrl);
    const tap = new AudioWorkletNode(context, 'capture-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    tap.port.onmessage = ({ data }: MessageEvent<{ pcm: ArrayBuffer; rms: number }>) => {
      handlers.chunk(new Int16Array(data.pcm));
      handlers.level(data.rms);
    };
    tap.connect(context.destination); // keeps the node processing; it outputs silence

    let source: AudioNode;
    if (kind === 'mic') {
      const stream = await getMicrophone();
      const track = stream.getAudioTracks()[0];
      track.addEventListener('ended', () => handlers.ended('Your microphone was disconnected.'));
      track.addEventListener('mute', () =>
        handlers.paused(
          'Capture is paused: the system took the microphone (call, lock screen or another app).',
        ),
      );
      track.addEventListener('unmute', () => handlers.resumed());
      source = context.createMediaStreamSource(stream);
      cleanups.push(() => track.stop());
    } else {
      const response = await fetch(FILE_URLS[kind]);
      const buffer = await context.decodeAudioData(await response.arrayBuffer());
      const player = context.createBufferSource();
      player.buffer = buffer;
      player.loop = true;
      player.start();
      source = player;
      cleanups.push(() => player.stop());
    }
    source.connect(tap);

    // Phones suspend audio when the screen locks or the tab is hidden; come back with the tab.
    const onVisible = () => {
      if (document.visibilityState === 'visible' && context.state === 'suspended')
        void context.resume();
    };
    document.addEventListener('visibilitychange', onVisible);
    cleanups.push(() => document.removeEventListener('visibilitychange', onVisible));
    context.addEventListener('statechange', () => {
      if (context.state === 'suspended')
        handlers.paused('Audio was suspended by the browser. Return to this tab to resume.');
      else if (context.state === 'running') handlers.resumed();
    });
    if (context.state === 'suspended') await context.resume();

    return {
      sampleRate: context.sampleRate,
      async stop() {
        for (const cleanup of cleanups) cleanup();
        source.disconnect();
        tap.disconnect();
        tap.port.close();
        await context.close();
      },
    };
  } catch (error) {
    for (const cleanup of cleanups) cleanup();
    await context.close();
    throw toCaptureError(error);
  }
}

async function getMicrophone(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new CaptureError(
      'Microphone capture needs a secure page: open the simulator over HTTPS or on localhost. You can still use an audio file as your input.',
      false,
    );
  }
  // Automatic gain control would fight the mixer's own level tracking; noise suppression helps it.
  return navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: false,
    },
  });
}

function toCaptureError(error: unknown): CaptureError {
  if (error instanceof CaptureError) return error;
  const name = error instanceof DOMException ? error.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return new CaptureError(
        'Microphone access was blocked. Allow the microphone for this site in your browser settings, then try again.',
      );
    case 'NotFoundError':
    case 'OverconstrainedError':
      return new CaptureError(
        'No microphone was found. Plug one in, or use an audio file as your input.',
      );
    case 'NotReadableError':
    case 'AbortError':
      return new CaptureError(
        'The microphone could not be started. Another app may be using it; close it and try again.',
      );
    default:
      return new CaptureError(
        error instanceof Error ? error.message : 'Audio capture could not start.',
      );
  }
}
