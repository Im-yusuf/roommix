import { describe, expect, it } from 'vitest';
import { MixerError } from '../src/errors.js';
import { gainSharing } from '../src/mix/gain-sharing.js';
import { plainSum } from '../src/mix/plain-sum.js';
import { strategyByName } from '../src/mix/strategies.js';

describe('strategies', () => {
  it('gain sharing splits unity in proportion to activity above the floor', () => {
    const gains: number[] = [];
    gainSharing.computeGains(
      [
        { level: 0.3, floor: 0.1 },
        { level: 0.2, floor: 0.1 },
        { level: 0.05, floor: 0.1 },
      ],
      gains,
    );
    expect(gains[0]).toBeCloseTo(2 / 3);
    expect(gains[1]).toBeCloseTo(1 / 3);
    expect(gains[2]).toBe(0);
    expect(gains[0] + gains[1] + gains[2]).toBeCloseTo(1);
  });

  it('gain sharing gives every source 1/N in silence', () => {
    const gains: number[] = [];
    gainSharing.computeGains(
      [
        { level: 1e-6, floor: 1e-6 },
        { level: 1e-6, floor: 1e-6 },
      ],
      gains,
    );
    expect(gains).toEqual([0.5, 0.5]);
  });

  it('plain sum is unity everywhere', () => {
    const gains: number[] = [];
    plainSum.computeGains(
      [
        { level: 1, floor: 0 },
        { level: 0, floor: 0 },
      ],
      gains,
    );
    expect(gains).toEqual([1, 1]);
  });

  it('rejects unknown strategy names', () => {
    expect(() => strategyByName('loudest-wins')).toThrowError(MixerError);
    expect(strategyByName('plain-sum')).toBe(plainSum);
  });
});
