import { describe, expect, it } from 'vitest';
import { LIMITER_CEILING } from '../src/constants.js';
import { createLimiter } from '../src/mix/limiter.js';
import { render, sine } from './helpers.js';

describe('limiter', () => {
  it('leaves a quiet frame untouched', () => {
    const limiter = createLimiter();
    const frame = render(sine(440, 0.5), 16000, 0, 320);
    const copy = frame.slice();
    expect(limiter.process(frame)).toBe(1);
    expect(frame).toEqual(copy);
  });

  it('brings a hot frame under the ceiling and recovers slowly', () => {
    const limiter = createLimiter();
    const hot = render(sine(440, 2.5), 16000, 0, 320);
    const gain = limiter.process(hot);
    expect(gain).toBeCloseTo(LIMITER_CEILING / 2.5, 3);
    for (const v of hot) expect(Math.abs(v)).toBeLessThanOrEqual(1);
    // Steady state: the ramp has settled, peaks sit exactly at the ceiling.
    const next = render(sine(440, 2.5), 16000, 320, 320);
    limiter.process(next);
    expect(Math.max(...next.map(Math.abs))).toBeLessThanOrEqual(LIMITER_CEILING + 1e-6);

    const quiet = new Float32Array(320);
    let g = limiter.gain;
    for (let i = 0; i < 10; i++) {
      const after = limiter.process(quiet);
      expect(after).toBeGreaterThan(g);
      g = after;
    }
    expect(g).toBeLessThan(1); // 200 ms is not enough to recover fully
  });
});
