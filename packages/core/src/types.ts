/**
 * The public contract of the mixer, fixed before any processing exists so the
 * integration surface does not drift while the internals are built.
 */

export type StrategyName = 'gain-sharing' | 'plain-sum';

/** Accepted shapes for a pushed chunk: PCM16 little-endian, any length. */
export type PcmChunk = Int16Array | Uint8Array | ArrayBuffer;

export type SourceState = 'joining' | 'live' | 'stalled' | 'left';

export interface SourceOptions {
  /** Sample rate of the PCM this source will push. */
  sampleRate: number;
  /** Interleaved channel count of the pushed PCM; mixed down to mono. Default 1. */
  channels?: number;
}

export interface MixerOptions {
  /** Default 'gain-sharing'. */
  strategy?: StrategyName;
  /** Default JITTER_TARGET_MS. */
  jitterTargetMs?: number;
  /** Default JITTER_MAX_MS. */
  jitterMaxMs?: number;
}

/** Per-source numbers as of the frame they travel with. */
export interface SourceSnapshot {
  id: string;
  state: SourceState;
  /** Smoothed RMS, 0..1 full scale. */
  level: number;
  /** Tracked noise floor, same units. */
  floor: number;
  /** Mix gain, 0..1. */
  gain: number;
}

/** Everything a UI or an integrator wants to know about one source. */
export interface SourceStats extends SourceSnapshot {
  bufferMs: number;
  underruns: number;
  drops: number;
  inserts: number;
  chunksIn: number;
}

export interface MixedFrame {
  /** Counts up by one per frame; a consumer can detect its own gaps. */
  sequence: number;
  /** FRAME_SAMPLES of 16 kHz mono PCM16, a fresh array per frame. */
  pcm: Int16Array;
  /** Source currently carrying the mix, or null in silence. */
  dominant: string | null;
  sources: SourceSnapshot[];
  limiterGain: number;
}

export interface MixerEvents extends Record<string, unknown> {
  frame: MixedFrame;
  /** Per source, every STATS_INTERVAL_MS and on every state change. */
  stats: SourceStats;
}

export interface Mixer {
  addSource(id: string, options: SourceOptions): void;
  /** Accepts any chunk size; throws MixerError for malformed input. */
  push(id: string, chunk: PcmChunk): void;
  /** The source fades out over its next frame and is then reported as `left`. */
  removeSource(id: string): void;
  setStrategy(name: StrategyName): void;
  readonly strategy: StrategyName;
  readonly sourceIds: string[];
  stats(): SourceStats[];
  /**
   * Emits every frame owed up to `nowMs` (any monotonic millisecond clock).
   * Call it as often as you like; the spacing of calls does not matter.
   */
  tick(nowMs: number): void;
  on<K extends keyof MixerEvents>(event: K, handler: (payload: MixerEvents[K]) => void): () => void;
}
