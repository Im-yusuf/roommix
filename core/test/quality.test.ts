import { describe, expect, it } from 'vitest';
import { FRAME_SAMPLES, type StrategyName } from '../src/index.js';
import { db, maxStep, noise, rmsOf, sampleAt, simulate, sine, toneRms } from './helpers.js';

const WARMUP_MS = 500;

describe('mix quality', () => {
  /** Output level in dB relative to the input tone for a steady two-source scenario. */
  function duplicateResponseDb(strategy: StrategyName, freq: number): number {
    const amplitude = 0.25;
    const { pcm } = simulate({
      strategy,
      durationMs: 1000,
      sources: [
        { id: 'near', sampleRate: 16000, signal: sine(freq, amplitude) },
        // Same voice on the other device: 10 dB quieter, 3 ms later.
        { id: 'far', sampleRate: 16000, signal: sine(freq, amplitude * 10 ** (-10 / 20), 0.003) },
      ],
    });
    return db(rmsOf(pcm, sampleAt(600), sampleAt(1000)) / 32768) - db(amplitude / Math.SQRT2);
  }

  it('suppresses the duplicate: comb-filter ripple is far smaller with gain sharing than plain sum', () => {
    // Multiples of 166.7 Hz alternate between the nulls and peaks of a 3 ms comb.
    const freqs = Array.from({ length: 20 }, (_, k) => ((k + 1) * 1000) / 6);
    const ripple = (strategy: StrategyName) => {
      const response = freqs.map((f) => duplicateResponseDb(strategy, f));
      return Math.max(...response) - Math.min(...response);
    };
    const plainSum = ripple('plain-sum');
    const gainSharing = ripple('gain-sharing');
    expect(plainSum).toBeGreaterThan(4.5); // theory: 5.7 dB
    expect(gainSharing).toBeLessThan(2.5); // theory: 1.7 dB
    expect(gainSharing).toBeLessThan(plainSum / 2);
  });

  it('keeps identical streams at single-source level instead of doubling', () => {
    const single = simulate({
      durationMs: 1000,
      sources: [{ id: 'a', sampleRate: 16000, signal: sine(1000, 0.25) }],
    });
    const run = (strategy: StrategyName) =>
      simulate({
        strategy,
        durationMs: 1000,
        sources: [
          { id: 'a', sampleRate: 16000, signal: sine(1000, 0.25) },
          { id: 'b', sampleRate: 16000, signal: sine(1000, 0.25) },
        ],
      });
    const ref = db(rmsOf(single.pcm, sampleAt(WARMUP_MS)));
    expect(Math.abs(db(rmsOf(run('gain-sharing').pcm, sampleAt(WARMUP_MS))) - ref)).toBeLessThan(
      0.5,
    );
    expect(db(rmsOf(run('plain-sum').pcm, sampleAt(WARMUP_MS))) - ref).toBeCloseTo(6, 0);
  });

  it('passes a single source through at unity', () => {
    const { pcm } = simulate({
      durationMs: 1000,
      sources: [{ id: 'a', sampleRate: 48000, signal: sine(1000, 0.25) }],
    });
    const out = db(rmsOf(pcm, sampleAt(WARMUP_MS)) / 32768);
    expect(Math.abs(out - db(0.25 / Math.SQRT2))).toBeLessThan(0.2);
  });

  it('never clips with full-scale input on every source', () => {
    const sources = ['a', 'b', 'c'].map((id) => ({ id, sampleRate: 16000, signal: sine(300, 1) }));
    const gs = simulate({ strategy: 'gain-sharing', durationMs: 1000, sources }).pcm;
    const ps = simulate({ strategy: 'plain-sum', durationMs: 1000, sources }).pcm;
    for (const pcm of [gs, ps]) {
      for (let i = 0; i < pcm.length; i++) {
        if (pcm[i] > 32767 || pcm[i] < -32768) throw new Error(`out of range at ${i}`);
      }
    }
    // Gain sharing: full-scale in, full-scale out, nothing squashed against the rails.
    const gsPeak = Math.max(...Array.from(gs.subarray(sampleAt(WARMUP_MS))).map(Math.abs));
    expect(gsPeak).toBeGreaterThan(0.95 * 32768);
    const railed = Array.from(gs.subarray(sampleAt(WARMUP_MS))).filter(
      (v) => v >= 32767 || v <= -32768,
    ).length;
    expect(railed / (gs.length - sampleAt(WARMUP_MS))).toBeLessThan(0.005);
    // Plain sum: the limiter holds a 3x overload under the ceiling once it has engaged.
    const psPeak = Math.max(...Array.from(ps.subarray(sampleAt(200))).map(Math.abs));
    expect(psPeak).toBeLessThanOrEqual(0.985 * 32768);
  });

  it('does not build up noise as sources are added', () => {
    const level = (strategy: StrategyName, count: number) => {
      const sources = Array.from({ length: count }, (_, i) => ({
        id: `s${i}`,
        sampleRate: 16000,
        signal: noise(100 + i, 0.1),
      }));
      return db(rmsOf(simulate({ strategy, durationMs: 1000, sources }).pcm, sampleAt(WARMUP_MS)));
    };
    const one = level('gain-sharing', 1);
    expect(level('gain-sharing', 2)).toBeLessThan(one + 1);
    expect(level('gain-sharing', 8)).toBeLessThan(one + 1);
    expect(level('plain-sum', 8)).toBeGreaterThan(level('plain-sum', 1) + 6); // theory: +9 dB
  });

  it('keeps both talkers when they speak at once', () => {
    // Each device hears its own talker loud and the other 10 dB down and 3 ms late.
    // Frequencies chosen so the 3 ms crosstalk copy is in quadrature: the comb neither
    // boosts nor cuts either voice, so this isolates gain sharing from comb filtering.
    const voiceA = sine(1.25 / 0.003, 0.2);
    const voiceB = sine(3.25 / 0.003, 0.2);
    const crosstalk = 10 ** (-10 / 20);
    const { pcm } = simulate({
      durationMs: 1500,
      sources: [
        {
          id: 'deviceA',
          sampleRate: 16000,
          signal: (t) => voiceA(t) + crosstalk * voiceB(t - 0.003),
        },
        {
          id: 'deviceB',
          sampleRate: 16000,
          signal: (t) => voiceB(t) + crosstalk * voiceA(t - 0.003),
        },
      ],
    });
    const from = sampleAt(WARMUP_MS);
    const a = db(toneRms(pcm, 1.25 / 0.003, 16000, from) / 32768) - db(0.2 / Math.SQRT2);
    const b = db(toneRms(pcm, 3.25 / 0.003, 16000, from) / 32768) - db(0.2 / Math.SQRT2);
    expect(Math.abs(a - b)).toBeLessThan(1.5);
    // Each voice ends up near half gain, the price of keeping the total at unity.
    expect(a).toBeGreaterThan(-8);
    expect(a).toBeLessThan(-1);
  });

  it('has no clicks through join, stall, leave and gain changes', () => {
    const amplitude = 0.5;
    const { pcm } = simulate({
      durationMs: 3000,
      sources: [
        { id: 'a', sampleRate: 16000, signal: sine(200, amplitude) },
        {
          id: 'b',
          sampleRate: 48000,
          signal: sine(200, amplitude * 0.6),
          joinMs: 1000,
          stallMs: [1400, 1700],
          leaveMs: 2000,
        },
      ],
    });
    const naturalStep = 2 * Math.PI * 200 * (1 / 16000) * amplitude * 32768;
    expect(maxStep(pcm, sampleAt(100))).toBeLessThan(naturalStep * 1.5);
    // and the tone is still there throughout
    expect(db(rmsOf(pcm, sampleAt(2500)) / 32768)).toBeGreaterThan(db(amplitude / Math.SQRT2) - 1);
  });

  it('does not flutter when two sources sit at nearly the same level', () => {
    // Two devices whose levels swap every frame by a few percent, as two equal talkers would.
    const wobble = (phase: number) => (t: number) =>
      0.2 * (1 + 0.05 * Math.sign(Math.sin(2 * Math.PI * 25 * t + phase)));
    const { frames } = simulate({
      durationMs: 2000,
      sources: [
        {
          id: 'a',
          sampleRate: 16000,
          signal: (t) => wobble(0)(t) * Math.sin(2 * Math.PI * 440 * t),
        },
        {
          id: 'b',
          sampleRate: 16000,
          signal: (t) => wobble(Math.PI)(t) * Math.sin(2 * Math.PI * 440 * t),
        },
      ],
    });
    const gains = frames.slice(50).map((f) => f.sources.find((s) => s.id === 'a')?.gain ?? 0);
    let maxStep = 0;
    for (let i = 1; i < gains.length; i++)
      maxStep = Math.max(maxStep, Math.abs(gains[i] - gains[i - 1]));
    expect(maxStep).toBeLessThan(0.02); // frame-to-frame change stays tiny
    expect(Math.min(...gains)).toBeGreaterThan(0.4); // and neither source is pushed out
    expect(Math.max(...gains)).toBeLessThan(0.6);
  });

  it('marks the dominant source and highlights the louder talker', () => {
    const { frames } = simulate({
      durationMs: 1000,
      sources: [
        { id: 'quiet', sampleRate: 16000, signal: sine(500, 0.05) },
        { id: 'loud', sampleRate: 16000, signal: sine(500, 0.4) },
      ],
    });
    const last = frames[frames.length - 1];
    expect(last.dominant).toBe('loud');
    expect(last.pcm.length).toBe(FRAME_SAMPLES);
    const loud = last.sources.find((s) => s.id === 'loud');
    const quiet = last.sources.find((s) => s.id === 'quiet');
    expect(loud?.gain).toBeGreaterThan(0.8);
    expect(quiet?.gain).toBeLessThan(0.2);
  });
});
