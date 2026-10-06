import { describe, expect, it } from 'vitest';
import { createDcBlocker } from '../src/pipeline/dc-blocker.js';
import { db, render, rmsOf, sine } from './helpers.js';

describe('dc blocker', () => {
  it('removes a DC offset', () => {
    const blocker = createDcBlocker(16000);
    const samples = new Float32Array(16000).fill(0.3);
    blocker.process(samples);
    let mean = 0;
    for (let i = 8000; i < 16000; i++) mean += samples[i];
    expect(Math.abs(mean / 8000)).toBeLessThan(1e-3);
  });

  it('passes speech-band tones within 0.1 dB', () => {
    const blocker = createDcBlocker(48000);
    const samples = render(sine(300, 0.5), 48000, 0, 48000);
    const before = rmsOf(samples, 24000);
    blocker.process(samples);
    expect(Math.abs(db(rmsOf(samples, 24000)) - db(before))).toBeLessThan(0.1);
  });
});
