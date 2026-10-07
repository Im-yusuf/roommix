import {
  FRAME_MS,
  FRAME_SAMPLES,
  MAX_CHUNK_MS,
  MAX_SAMPLE_RATE,
  MIN_SAMPLE_RATE,
  QUIET_MARGIN_DB,
  SAMPLE_RATE,
  STALL_AFTER_MS,
} from './constants.js';
import { MixerError } from './errors.js';
import { createDcBlocker } from './pipeline/dc-blocker.js';
import { fadeOut } from './pipeline/fade.js';
import { createFramer } from './pipeline/framer.js';
import { createJitterBuffer, type JitterBufferConfig } from './pipeline/jitter-buffer.js';
import { createLevelMeter, dbToLinear, type LevelReading, rms } from './pipeline/level-meter.js';
import { pcm16ToFloat, toInt16, toMono } from './pipeline/pcm.js';
import { createResampler } from './pipeline/resampler.js';
import type { PcmChunk, SourceOptions, SourceState, SourceStats } from './types.js';

const STALL_FRAMES = STALL_AFTER_MS / FRAME_MS;
const QUIET_MARGIN = dbToLinear(QUIET_MARGIN_DB);
const SILENCE = new Float32Array(FRAME_SAMPLES);

/**
 * One input stream: validation, conversion to canonical float frames, the
 * jitter buffer, and the state machine the mixer and UIs read.
 *
 *   joining --(buffer primed)--> live <--> stalled      any --(leave)--> left
 *
 * The mixer never waits on a source: `pull` always answers immediately, with a
 * frame or with null meaning "silence this tick".
 */
export function createSource(id: string, options: SourceOptions, buffer: JitterBufferConfig) {
  const { sampleRate } = options;
  const channels = options.channels ?? 1;
  if (
    !Number.isInteger(sampleRate) ||
    sampleRate < MIN_SAMPLE_RATE ||
    sampleRate > MAX_SAMPLE_RATE
  ) {
    throw new MixerError(
      'invalid_sample_rate',
      `Source "${id}": sampleRate must be an integer between ${MIN_SAMPLE_RATE} and ${MAX_SAMPLE_RATE}, got ${sampleRate}`,
    );
  }
  if (!Number.isInteger(channels) || channels < 1 || channels > 8) {
    throw new MixerError(
      'invalid_channels',
      `Source "${id}": channels must be 1..8, got ${channels}`,
    );
  }
  const maxChunkSamples = (sampleRate * channels * MAX_CHUNK_MS) / 1000;

  // The processing chain, in order. Each stage keeps its own state across chunks,
  // so the output does not depend on how the audio was split when it was pushed.
  const dcBlocker = createDcBlocker(sampleRate);
  const resampler = createResampler(sampleRate, SAMPLE_RATE);
  const framer = createFramer();
  const meter = createLevelMeter();

  let state: SourceState = 'joining';
  let leaving = false;
  let consecutiveUnderruns = 0;
  let chunksIn = 0;
  let reading: LevelReading = meter.reading;

  // Quiet means close to this source's own noise floor: a drift correction there is inaudible.
  const jitter = createJitterBuffer(buffer, (frame) => rms(frame) < reading.floor * QUIET_MARGIN);

  return {
    id,

    /** Current mix gain, owned by the mixer; kept here so it travels with the source. */
    gain: 0,

    get state(): SourceState {
      return state;
    },

    get reading(): LevelReading {
      return reading;
    },

    push(chunk: PcmChunk): void {
      const pcm = toInt16(chunk);
      if (pcm.length % channels !== 0) {
        throw new MixerError(
          'invalid_chunk',
          `Source "${id}": ${pcm.length} samples is not a whole number of ${channels}-channel frames`,
        );
      }
      if (pcm.length > maxChunkSamples) {
        throw new MixerError(
          'chunk_too_large',
          `Source "${id}": chunk longer than ${MAX_CHUNK_MS} ms`,
        );
      }
      chunksIn++;
      // int16 → float → mono → remove DC → resample to 16 kHz → cut into 20 ms frames → queue.
      const samples = toMono(pcm16ToFloat(pcm), channels);
      dcBlocker.process(samples);
      framer.push(resampler.process(samples), (frame) => jitter.push(frame));
    },

    /** Ask the source to go: its next pull plays one faded frame (if any) and it becomes `left`. */
    leave(): void {
      leaving = true;
    },

    /** The frame for this tick, or null for silence. Also advances the state machine and the level meter. */
    pull(): Float32Array | null {
      if (state === 'left') return null;
      const frame = jitter.pull();
      if (leaving) {
        // Last frame: fade it so the source does not end on a click.
        if (frame) fadeOut(frame);
        state = 'left';
      } else if (frame) {
        consecutiveUnderruns = 0;
        state = 'live';
      } else if (state !== 'joining') {
        // No frame, but a short gap is just jitter; only a sustained one is a stall.
        consecutiveUnderruns++;
        if (consecutiveUnderruns >= STALL_FRAMES) state = 'stalled';
      }
      // A missing frame counts as silence, so the level of a stalled source decays to zero.
      reading = meter.update(frame ?? SILENCE);
      return frame;
    },

    stats(): SourceStats {
      const { depthFrames, underruns, drops, inserts } = jitter.stats;
      return {
        id,
        state,
        level: reading.level,
        floor: reading.floor,
        gain: this.gain,
        bufferMs: depthFrames * FRAME_MS,
        underruns,
        drops,
        inserts,
        chunksIn,
      };
    },
  };
}

export type Source = ReturnType<typeof createSource>;
