import deviceAUrl from '../../../../fixtures/deviceA.wav?url';
import deviceBUrl from '../../../../fixtures/deviceB.wav?url';
import captureWorkletUrl from './worklets/capture-processor.ts?worker&url';

export type InputKind = 'fileA' | 'fileB';

export interface CaptureHandlers {
  chunk(pcm: Int16Array): void;
  level(rms: number): void;
  paused(reason: string): void;
  resumed(): void;
}

export interface Capture {
  /** The rate the browser actually gave us; sent to the server, which resamples. */
  sampleRate: number;
  stop(): Promise<void>;
}

const FILE_URLS: Record<InputKind, string> = { fileA: deviceAUrl, fileB: deviceBUrl };

/**
 * Plays a looping fixture clip, standing in for a microphone, through an
 * AudioWorklet that produces 20 ms PCM16 chunks. Must be called from a user
 * gesture so the AudioContext may start.
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

    const response = await fetch(FILE_URLS[kind]);
    const buffer = await context.decodeAudioData(await response.arrayBuffer());
    const player = context.createBufferSource();
    player.buffer = buffer;
    player.loop = true;
    player.start();
    player.connect(tap);
    cleanups.push(() => player.stop());

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
        player.disconnect();
        tap.disconnect();
        tap.port.close();
        await context.close();
      },
    };
  } catch (error) {
    for (const cleanup of cleanups) cleanup();
    await context.close();
    throw error instanceof Error ? error : new Error('Audio capture could not start.');
  }
}
