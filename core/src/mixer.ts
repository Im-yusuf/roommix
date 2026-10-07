import {
  DOMINANT_HYSTERESIS_DB,
  FRAME_MS,
  FRAME_SAMPLES,
  GAIN_SMOOTHING_MS,
  JITTER_MAX_MS,
  JITTER_TARGET_MS,
  MAX_CATCHUP_MS,
  STATS_INTERVAL_MS,
} from './constants.js';
import { createEmitter } from './emitter.js';
import { MixerError } from './errors.js';
import { addWithGainRamp } from './mix/gain-ramp.js';
import { createLimiter } from './mix/limiter.js';
import { strategyByName } from './mix/strategies.js';
import { dbToLinear } from './pipeline/level-meter.js';
import { floatToPcm16 } from './pipeline/pcm.js';
import { createSource, type Source } from './source.js';
import type {
  Mixer,
  MixerEvents,
  MixerOptions,
  PcmChunk,
  SourceOptions,
  SourceState,
  SourceStats,
  StrategyName,
} from './types.js';

// One-pole smoothing coefficient per frame: each frame a gain moves this
// fraction of the remaining distance to its target (~63% after GAIN_SMOOTHING_MS).
const GAIN_SMOOTHING = 1 - Math.exp(-FRAME_MS / GAIN_SMOOTHING_MS);
/** A challenger must have this many times the current dominant's activity to take over. */
const DOMINANT_RATIO = dbToLinear(DOMINANT_HYSTERESIS_DB);
const MAX_CATCHUP_FRAMES = MAX_CATCHUP_MS / FRAME_MS;
const STATS_INTERVAL_FRAMES = STATS_INTERVAL_MS / FRAME_MS;

/**
 * Owns the output clock. Sources push audio whenever it arrives; `tick(now)`
 * produces exactly the frames owed since the last tick, pulling one frame (or
 * silence) from every source, so the mix never waits on anyone.
 */
export function createMixer(options: MixerOptions = {}): Mixer {
  const jitter = {
    targetMs: options.jitterTargetMs ?? JITTER_TARGET_MS,
    maxMs: options.jitterMaxMs ?? JITTER_MAX_MS,
  };
  let strategy = strategyByName(options.strategy ?? 'gain-sharing');
  const emitter = createEmitter<MixerEvents>();
  const sources = new Map<string, Source>();
  /** Removed sources that still owe one faded frame. */
  const leaving: Source[] = [];
  const limiter = createLimiter();
  // Reused every frame to avoid allocating in the hot path; only the emitted
  // PCM is a fresh array, because consumers may keep it.
  const mix = new Float32Array(FRAME_SAMPLES);
  const targetGains: number[] = [];
  /** Lets stats go out on a state change without waiting for the next periodic report. */
  const lastReportedState = new Map<Source, SourceState>();

  let sequence = 0;
  let dominant: string | null = null;
  // Frames owed are counted from a fixed origin rather than accumulated tick by
  // tick, so uneven tick spacing and rounding can never make the clock drift.
  let clockOrigin: number | undefined;
  let framesSinceOrigin = 0;
  let framesSinceStats = 0;

  function reportStats(source: Source): void {
    lastReportedState.set(source, source.state);
    emitter.emit('stats', source.stats());
  }

  /** Produces one 20 ms output frame: pull, weigh, sum, limit, convert, emit. */
  function mixFrame(): void {
    // Leaving sources still take part for one more frame so they can fade out.
    const active = [...sources.values(), ...leaving];
    mix.fill(0);

    // Every source answers at once, with a frame or null (silence). Pulling also
    // updates each source's level reading, which the strategy reads next.
    const frames = active.map((source) => source.pull());
    strategy.computeGains(
      active.map((source) => source.reading),
      targetGains,
    );

    for (let i = 0; i < active.length; i++) {
      const source = active[i];
      const previous = source.gain;
      const target = targetGains[i];
      // Smoothed with one coefficient so the gains keep summing to one; the
      // per-sample ramp inside addWithGainRamp removes the steps.
      const next = previous + (target - previous) * GAIN_SMOOTHING;
      source.gain = next;
      const frame = frames[i];
      if (frame) addWithGainRamp(mix, frame, previous, next);
    }

    // Float until here so the sum can exceed full scale without wrapping; the
    // limiter brings it back under, then it is converted to int16 once.
    const limiterGain = limiter.process(mix);
    const pcm = new Int16Array(FRAME_SAMPLES);
    floatToPcm16(mix, pcm);
    dominant = pickDominant(sources.values(), dominant);
    sequence++;

    emitter.emit('frame', {
      sequence,
      pcm,
      dominant,
      limiterGain,
      sources: [...sources.values()].map((s) => ({
        id: s.id,
        state: s.state,
        level: s.reading.level,
        floor: s.reading.floor,
        gain: s.gain,
      })),
    });

    // Stats go out every STATS_INTERVAL_MS, and immediately for any source whose state changed.
    framesSinceStats++;
    const periodic = framesSinceStats >= STATS_INTERVAL_FRAMES;
    if (periodic) framesSinceStats = 0;
    for (const source of active) {
      if (periodic || lastReportedState.get(source) !== source.state) reportStats(source);
    }
    // Sources that played their last faded frame are gone. Backwards, so splice skips nothing.
    for (let i = leaving.length - 1; i >= 0; i--) {
      if (leaving[i].state === 'left') {
        lastReportedState.delete(leaving[i]);
        leaving.splice(i, 1);
      }
    }
  }

  function requireSource(id: string): Source {
    const source = sources.get(id);
    if (!source) throw new MixerError('unknown_source', `No source "${id}"`);
    return source;
  }

  return {
    addSource(id: string, sourceOptions: SourceOptions): void {
      if (sources.has(id))
        throw new MixerError('duplicate_source', `Source "${id}" already exists`);
      const source = createSource(id, sourceOptions, jitter);
      sources.set(id, source);
      reportStats(source);
    },

    push(id: string, chunk: PcmChunk): void {
      requireSource(id).push(chunk);
    },

    /** The source fades out over its next frame and is then reported as `left`. */
    removeSource(id: string): void {
      const source = requireSource(id);
      sources.delete(id);
      source.leave();
      leaving.push(source);
    },

    setStrategy(name: StrategyName): void {
      strategy = strategyByName(name);
    },

    get strategy(): StrategyName {
      return strategy.name;
    },

    get sourceIds(): string[] {
      return [...sources.keys()];
    },

    stats(): SourceStats[] {
      return [...sources.values()].map((source) => source.stats());
    },

    /**
     * Emits every frame owed up to `nowMs` (any monotonic millisecond clock).
     * Call it as often as you like; the spacing of calls does not matter.
     */
    tick(nowMs: number): void {
      if (sources.size === 0 && leaving.length === 0) {
        clockOrigin = undefined; // idle: nothing to mix, nothing owed later
        return;
      }
      if (clockOrigin === undefined) {
        // First tick with a source: anchor the clock here. Frames are owed from now on.
        clockOrigin = nowMs;
        framesSinceOrigin = 0;
        return;
      }
      // Whole frames that should exist by now, minus those already emitted.
      let owed = Math.floor((nowMs - clockOrigin) / FRAME_MS) - framesSinceOrigin;
      if (owed > MAX_CATCHUP_FRAMES) {
        // The host stalled for a long time. Emitting it all now would flood
        // consumers with stale audio, so skip ahead instead.
        clockOrigin = nowMs - MAX_CATCHUP_MS;
        framesSinceOrigin = 0;
        owed = MAX_CATCHUP_FRAMES;
      }
      for (let i = 0; i < owed; i++) mixFrame();
      if (owed > 0) framesSinceOrigin += owed;
    },

    on: emitter.on,
  };
}

/**
 * The dominant source is the one with the most activity, but it only changes
 * when a challenger is clearly ahead; otherwise two equal talkers would make
 * the indicator flicker every frame.
 */
function pickDominant(candidates: Iterable<Source>, current: string | null): string | null {
  let best: Source | undefined;
  let bestActivity = 0;
  let currentActivity = 0;
  for (const source of candidates) {
    // Activity is level above the source's own noise floor, the same measure gain sharing uses.
    const activity = Math.max(0, source.reading.level - source.reading.floor);
    if (source.id === current) currentActivity = activity;
    if (activity > bestActivity) {
      best = source;
      bestActivity = activity;
    }
  }
  if (!best) return null; // everyone is at their floor: nobody is talking
  // Keep the current dominant unless the best challenger beats it by the hysteresis margin.
  if (current !== null && currentActivity > 0 && bestActivity < currentActivity * DOMINANT_RATIO)
    return current;
  return best.id;
}
