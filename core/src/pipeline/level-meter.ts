import {
  FLOOR_MAX_DBFS,
  FLOOR_MIN_DBFS,
  FLOOR_RISE_DB_PER_S,
  FRAME_MS,
  LEVEL_ATTACK_MS,
  LEVEL_RELEASE_MS,
} from '../constants.js';

export interface LevelReading {
  /** Smoothed RMS, linear full-scale units (1.0 = full scale). */
  level: number;
  /** Tracked noise floor in the same units. */
  floor: number;
}

export function dbToLinear(db: number): number {
  return 10 ** (db / 20);
}

export function rms(frame: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
  return Math.sqrt(sum / frame.length);
}

const ATTACK = 1 - Math.exp(-FRAME_MS / LEVEL_ATTACK_MS);
const RELEASE = 1 - Math.exp(-FRAME_MS / LEVEL_RELEASE_MS);
const FLOOR_RISE_PER_FRAME = dbToLinear((FLOOR_RISE_DB_PER_S * FRAME_MS) / 1000);
const FLOOR_MIN = dbToLinear(FLOOR_MIN_DBFS);
const FLOOR_MAX = dbToLinear(FLOOR_MAX_DBFS);

/**
 * Per-source level: RMS smoothed with a fast attack and slow release so the
 * reading follows speech onsets immediately but does not flutter between
 * syllables. The noise floor is a minimum follower: it drops to any lower
 * level at once and may only creep upward slowly, so pauses in speech reset
 * it but speech itself never becomes the floor.
 */
export function createLevelMeter() {
  let level = 0;
  let floor = FLOOR_MIN;

  return {
    update(frame: Float32Array): LevelReading {
      const current = rms(frame);
      level += (current - level) * (current > level ? ATTACK : RELEASE);
      floor =
        level < floor
          ? Math.max(level, FLOOR_MIN)
          : Math.min(floor * FLOOR_RISE_PER_FRAME, FLOOR_MAX);
      return { level, floor };
    },
    get reading(): LevelReading {
      return { level, floor };
    },
  };
}
