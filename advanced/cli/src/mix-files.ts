import {
  createMixer,
  FRAME_MS,
  JITTER_TARGET_MS,
  type SourceStats,
  type StrategyName,
  type WavData,
} from '@roommix/core';

export interface MixFilesOptions {
  /** Level the mix after the strategy, as the live service does. Default true. */
  leveler?: boolean;
}

export interface MixFilesResult {
  /** 16 kHz mono PCM16. Runs about 100 ms past the longest input while the buffers drain. */
  pcm: Int16Array;
  stats: SourceStats[];
}

/**
 * Mixes decoded WAV files exactly as live devices would be mixed: each file is
 * pushed 20 ms at a time against a simulated clock, so the jitter buffers,
 * resamplers and strategy run the same code path as the server.
 */
export function mixFiles(
  inputs: WavData[],
  strategy: StrategyName = 'gain-sharing',
  options: MixFilesOptions = {},
): MixFilesResult {
  const mixer = createMixer({ strategy, leveler: options.leveler ?? true });
  const frames: Int16Array[] = [];
  mixer.on('frame', (frame) => frames.push(frame.pcm));

  inputs.forEach((wav, i) => {
    mixer.addSource(sourceId(i), { sampleRate: wav.sampleRate, channels: wav.channels });
  });

  const consumed = inputs.map(() => 0);
  let now = 0;
  let step = 0;
  mixer.tick(now); // anchors the clock
  while (inputs.some((wav, i) => consumed[i] < wav.samples.length)) {
    now += FRAME_MS;
    step++;
    inputs.forEach((wav, i) => {
      // Cumulative rounding keeps odd rates (11025 Hz) from drifting.
      const end = Math.min(
        wav.samples.length,
        Math.round((wav.sampleRate * wav.channels * step * FRAME_MS) / 1000),
      );
      if (consumed[i] < end) {
        mixer.push(sourceId(i), wav.samples.subarray(consumed[i], end));
        consumed[i] = end;
      }
    });
    mixer.tick(now);
  }

  // Let the jitter buffers play out, then take a snapshot before the sources go.
  const drainFrames = Math.ceil(JITTER_TARGET_MS / FRAME_MS) + 2;
  for (let i = 0; i < drainFrames; i++) {
    now += FRAME_MS;
    mixer.tick(now);
  }
  const stats = mixer.stats();
  for (const id of mixer.sourceIds) mixer.removeSource(id);
  now += FRAME_MS;
  mixer.tick(now);

  const pcm = new Int16Array(frames.length * (frames[0]?.length ?? 0));
  frames.forEach((frame, i) => {
    pcm.set(frame, i * frame.length);
  });
  return { pcm, stats };
}

function sourceId(index: number): string {
  return `file${index + 1}`;
}
