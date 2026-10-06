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

const GAIN_SMOOTHING = 1 - Math.exp(-FRAME_MS / GAIN_SMOOTHING_MS);
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
  const mix = new Float32Array(FRAME_SAMPLES);
  const targetGains: number[] = [];
  const lastReportedState = new Map<Source, SourceState>();

  let sequence = 0;
  let dominant: string | null = null;
  let clockOrigin: number | undefined;
  let framesSinceOrigin = 0;
  let framesSinceStats = 0;

  function reportStats(source: Source): void {
    lastReportedState.set(source, source.state);
    emitter.emit('stats', source.stats());
  }

  function mixFrame(): void {
    const active = [...sources.values(), ...leaving];
    mix.fill(0);

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

    framesSinceStats++;
    const periodic = framesSinceStats >= STATS_INTERVAL_FRAMES;
    if (periodic) framesSinceStats = 0;
    for (const source of active) {
      if (periodic || lastReportedState.get(source) !== source.state) reportStats(source);
    }
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
        clockOrigin = nowMs;
        framesSinceOrigin = 0;
        return;
      }
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
    const activity = Math.max(0, source.reading.level - source.reading.floor);
    if (source.id === current) currentActivity = activity;
    if (activity > bestActivity) {
      best = source;
      bestActivity = activity;
    }
  }
  if (!best) return null;
  if (current !== null && currentActivity > 0 && bestActivity < currentActivity * DOMINANT_RATIO)
    return current;
  return best.id;
}
