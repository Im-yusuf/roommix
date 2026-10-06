import { FRAME_MS, LIMITER_CEILING, LIMITER_RELEASE_MS } from '../constants.js';

const RELEASE = 1 - Math.exp(-FRAME_MS / LIMITER_RELEASE_MS);

/**
 * Peak limiter on the mixed frame. The gain needed to keep this frame's peak
 * under the ceiling is applied as a ramp across the frame (a step would click)
 * and recovers slowly afterwards. Samples that overshoot during the ramp are
 * clamped. With gain sharing the mix gains sum to one, so this only works hard
 * for the plain-sum baseline.
 */
export function createLimiter() {
  let gain = 1;

  return {
    /** Limits in place and returns the gain reached at the end of the frame. */
    process(frame: Float32Array): number {
      let peak = 0;
      for (let i = 0; i < frame.length; i++) {
        const magnitude = Math.abs(frame[i]);
        if (magnitude > peak) peak = magnitude;
      }
      const released = gain + (1 - gain) * RELEASE;
      const target = peak * released > LIMITER_CEILING ? LIMITER_CEILING / peak : released;

      const step = (target - gain) / frame.length;
      let g = gain;
      for (let i = 0; i < frame.length; i++) {
        const v = frame[i] * g;
        frame[i] = v > 1 ? 1 : v < -1 ? -1 : v;
        g += step;
      }
      gain = target;
      return gain;
    },
    get gain(): number {
      return gain;
    },
  };
}
