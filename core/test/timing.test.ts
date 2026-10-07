import { describe, expect, it } from 'vitest';
import { FRAME_MS, JITTER_MAX_MS, JITTER_TARGET_MS, type SourceStats } from '../src/index.js';
import { db, gated, maxStep, rmsOf, sampleAt, simulate, sine, toneRms } from './helpers.js';

/** Collects every stats event with the fake-clock time it was emitted at. */
function recorder() {
  const events: { at: number; stats: SourceStats }[] = [];
  let clock = 0;
  return {
    events,
    setup: (mixer: { on: (e: 'stats', h: (s: SourceStats) => void) => unknown }) => {
      mixer.on('stats', (stats) => {
        events.push({ at: clock, stats });
      });
    },
    beforeTick: (now: number) => {
      clock = now;
    },
  };
}

describe('timing', () => {
  it('a late joiner is heard within the jitter target and disturbs nothing', () => {
    const { pcm } = simulate({
      durationMs: 4000,
      sources: [
        { id: 'a', sampleRate: 16000, signal: sine(500, 0.2) },
        { id: 'b', sampleRate: 48000, signal: sine(2000, 0.2), joinMs: 2000 },
      ],
    });
    const settle = 2000 + JITTER_TARGET_MS + 100;
    expect(toneRms(pcm, 2000, 16000, sampleAt(1500), sampleAt(1900)) / 32768).toBeLessThan(0.001);
    expect(
      toneRms(pcm, 2000, 16000, sampleAt(settle), sampleAt(settle + 400)) / 32768,
    ).toBeGreaterThan(0.05);
    expect(
      toneRms(pcm, 500, 16000, sampleAt(settle), sampleAt(settle + 400)) / 32768,
    ).toBeGreaterThan(0.05);
    const naturalStep = 2 * Math.PI * 2000 * (1 / 16000) * 0.2 * 32768;
    expect(maxStep(pcm, sampleAt(100))).toBeLessThan(naturalStep * 1.5);
  });

  it('absorbs arrival jitter and bounds latency after a stall and burst', () => {
    const rec = recorder();
    const { pcm } = simulate({
      durationMs: 10_000,
      sources: [
        {
          id: 'a',
          sampleRate: 48000,
          signal: sine(440, 0.3),
          arrivalJitterMs: 40,
          stallMs: [5000, 5500],
        },
      ],
      ...rec,
    });
    const stats = (from: number, to: number) =>
      rec.events.filter((e) => e.at >= from && e.at < to).map((e) => e.stats);
    // Jitter below the target causes no underruns...
    const beforeStall = stats(500, 5000);
    expect(beforeStall.length).toBeGreaterThan(10);
    expect(beforeStall.at(-1)?.underruns).toBe(0);
    for (const s of beforeStall)
      expect(s.bufferMs).toBeLessThanOrEqual(JITTER_TARGET_MS + 2 * FRAME_MS + 40);
    // ...the stall is reported, the burst is trimmed, and latency never exceeds the maximum.
    const during = stats(5000, 5600);
    expect(during.some((s) => s.state === 'stalled')).toBe(true);
    const after = stats(5600, 10_000);
    expect(after.at(-1)?.drops).toBeGreaterThan(0);
    for (const s of after) expect(s.bufferMs).toBeLessThanOrEqual(JITTER_MAX_MS);
    expect(after.at(-1)?.underruns).toBe(after[0]?.underruns); // no new underruns once recovered
    // Output is continuous after recovery: the tone is present in every 200 ms window.
    for (let t = 6000; t < 10_000; t += 200) {
      expect(db(rmsOf(pcm, sampleAt(t), sampleAt(t + 200)) / 32768)).toBeGreaterThan(
        db(0.3 / Math.SQRT2) - 2,
      );
    }
    const naturalStep = 2 * Math.PI * 440 * (1 / 16000) * 0.3 * 32768;
    expect(maxStep(pcm, sampleAt(100))).toBeLessThan(naturalStep * 1.5);
  });

  it.each([200, -200])(
    'keeps buffer depth bounded over 30 minutes at %i ppm clock drift',
    (ppm) => {
      const rec = recorder();
      simulate({
        durationMs: 30 * 60 * 1000,
        sources: [
          { id: 'a', sampleRate: 16000, signal: gated(sine(400, 0.3), 1, 0.5), clockPpm: ppm },
        ],
        ...rec,
      });
      const steady = rec.events.filter((e) => e.at >= 1000).map((e) => e.stats);
      const depths = steady.map((s) => s.bufferMs);
      expect(Math.max(...depths)).toBeLessThanOrEqual(JITTER_TARGET_MS + 2 * FRAME_MS);
      expect(Math.min(...depths)).toBeGreaterThanOrEqual(JITTER_TARGET_MS - 2 * FRAME_MS);
      const last = steady.at(-1);
      expect(last?.underruns).toBe(0);
      // 200 ppm over 30 minutes is 360 ms, which is 18 frames to drop or repeat.
      const corrections = ppm > 0 ? last?.drops : last?.inserts;
      expect(corrections).toBeGreaterThanOrEqual(15);
      expect(corrections).toBeLessThanOrEqual(21);
    },
  );

  it('still corrects drift, click-free, when the source is never quiet', () => {
    const rec = recorder();
    const { pcm } = simulate({
      durationMs: 5 * 60 * 1000,
      sources: [{ id: 'a', sampleRate: 16000, signal: sine(400, 0.3), clockPpm: 200 }],
      ...rec,
    });
    const steady = rec.events.filter((e) => e.at >= 1000).map((e) => e.stats);
    expect(Math.max(...steady.map((s) => s.bufferMs))).toBeLessThanOrEqual(
      JITTER_TARGET_MS + 2 * FRAME_MS,
    );
    expect(steady.at(-1)?.drops).toBeGreaterThanOrEqual(2);
    const naturalStep = 2 * Math.PI * 400 * (1 / 16000) * 0.3 * 32768;
    expect(maxStep(pcm, sampleAt(100))).toBeLessThan(naturalStep * 1.5);
  });
});
