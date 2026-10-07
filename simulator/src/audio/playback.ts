import playbackWorkletUrl from './worklets/playback-processor.ts?worker&url';

export interface PlaybackStats {
  bufferMs: number;
  underruns: number;
  dropped: number;
  rms: number;
}

export interface Playback {
  push(frame: Int16Array): void;
  stop(): Promise<void>;
}

/** Plays mixed 16 kHz frames. Must be called from a user gesture so the AudioContext may start. */
export async function startPlayback(onStats: (stats: PlaybackStats) => void): Promise<Playback> {
  let context: AudioContext;
  try {
    context = new AudioContext({ sampleRate: 16000 });
  } catch {
    context = new AudioContext(); // the worklet interpolates when the rate differs
  }
  await context.audioWorklet.addModule(playbackWorkletUrl);
  const player = new AudioWorkletNode(context, 'playback-processor', {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [1],
  });
  player.port.onmessage = ({ data }: MessageEvent<PlaybackStats>) => onStats(data);
  player.connect(context.destination);
  if (context.state === 'suspended') await context.resume();
  return {
    push(frame) {
      const copy = frame.slice();
      player.port.postMessage(copy.buffer, [copy.buffer]);
    },
    async stop() {
      player.disconnect();
      player.port.close();
      await context.close();
    },
  };
}
