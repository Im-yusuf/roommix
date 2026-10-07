import { FLOOR_MIN_DBFS } from '../constants.js';
import { dbToLinear } from '../pipeline/level-meter.js';
import type { MixStrategy } from './strategy.js';

/** Total activity below this is silence; the share would be noise divided by noise. */
const SILENCE = dbToLinear(FLOOR_MIN_DBFS);

/**
 * Dugan-style gain sharing. Each source gets the fraction of the total that
 * its own activity (level above its noise floor) represents, so the gains
 * always sum to one. The talker's own device dominates; the other devices,
 * which hear the same voice quieter and later, are turned down in proportion.
 * In silence every source gets 1/N, which is why noise does not build up as
 * devices join.
 */
export const gainSharing: MixStrategy = {
  name: 'gain-sharing',
  computeGains(readings, gains) {
    gains.length = readings.length;
    let total = 0;
    for (let i = 0; i < readings.length; i++) {
      const activity = Math.max(0, readings[i].level - readings[i].floor);
      gains[i] = activity;
      total += activity;
    }
    if (total <= SILENCE) {
      gains.fill(1 / readings.length);
      return;
    }
    for (let i = 0; i < readings.length; i++) gains[i] /= total;
  },
};
