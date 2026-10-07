import type { MixStrategy } from './strategy.js';

/** Baseline for A/B comparison: every source at unity, duplicates comb-filter freely. */
export const plainSum: MixStrategy = {
  name: 'plain-sum',
  computeGains(readings, gains) {
    gains.length = readings.length;
    gains.fill(1);
  },
};
