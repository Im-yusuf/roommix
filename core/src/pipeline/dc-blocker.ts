import { DC_BLOCK_CUTOFF_HZ } from '../constants.js';

/**
 * One-pole high-pass: y[n] = x[n] - x[n-1] + r * y[n-1].
 * Removes microphone DC offset, which would otherwise inflate every level
 * reading and bias the gain sharing. State carries across chunks.
 */
export function createDcBlocker(sampleRate: number) {
  // Pole radius just under 1: the closer to 1, the lower the cutoff. This places it at ~20 Hz.
  const r = 1 - (2 * Math.PI * DC_BLOCK_CUTOFF_HZ) / sampleRate;
  let prevIn = 0;
  let prevOut = 0;

  return {
    /** Filters in place. */
    process(samples: Float32Array): void {
      for (let i = 0; i < samples.length; i++) {
        const x = samples[i];
        // x - prevIn cancels anything constant; r * prevOut restores everything that changes.
        const y = x - prevIn + r * prevOut;
        prevIn = x;
        prevOut = y;
        samples[i] = y;
      }
    },
  };
}
