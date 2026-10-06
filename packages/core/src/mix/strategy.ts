import type { LevelReading } from '../pipeline/level-meter.js';
import type { StrategyName } from '../types.js';

export interface MixStrategy {
  readonly name: StrategyName;
  /** Writes one target gain per source into `gains`, in the same order as `readings`. */
  computeGains(readings: readonly LevelReading[], gains: number[]): void;
}
