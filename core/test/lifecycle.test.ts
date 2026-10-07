import { describe, expect, it } from 'vitest';
import { FRAME_MS, JITTER_TARGET_MS, type SourceStats } from '../src/index.js';
import { simulate, sine } from './helpers.js';

const WARMUP_MS = 500;

describe('lifecycle', () => {
  it('removes a source after one more frame and reports the lifecycle', () => {
    const states: string[] = [];
    let clock = 0;
    const { frames } = simulate({
      durationMs: 1000,
      sources: [{ id: 'a', sampleRate: 16000, signal: sine(440), leaveMs: 500 }],
      setup: (mixer) => {
        mixer.on('stats', (s: SourceStats) => {
          states.push(`${s.state}@${clock}`);
        });
      },
      beforeTick: (now) => {
        clock = now;
      },
    });
    expect(states[0]).toBe('joining@0');
    // The buffer primes when the frame completing the target depth arrives, then the first frame plays.
    expect(states[1]).toBe(`live@${JITTER_TARGET_MS - FRAME_MS}`);
    expect(states.at(-1)).toBe('left@500');
    // The frame mixed at the leave tick still carries the fading source's audio but no longer lists it...
    const atLeave = frames.at(-1);
    expect(atLeave?.sequence).toBe(500 / FRAME_MS);
    expect(atLeave?.sources).toEqual([]);
    // ...and after it the mixer idles: zero sources, zero frames.
    expect(frames.length).toBe(500 / FRAME_MS);
  });

  it('reports stats periodically with buffer depth', () => {
    const seen: { stats: SourceStats; at: number }[] = [];
    let clock = 0;
    simulate({
      durationMs: 1000,
      sources: [{ id: 'a', sampleRate: 48000, signal: sine(440) }],
      setup: (mixer) => {
        mixer.on('stats', (stats) => {
          seen.push({ stats, at: clock });
        });
      },
      beforeTick: (now) => {
        clock = now;
      },
    });
    const live = seen
      .filter((e) => e.stats.state === 'live' && e.at >= WARMUP_MS)
      .map((e) => e.stats);
    expect(live.length).toBeGreaterThanOrEqual(2);
    for (const s of live) {
      expect(s.bufferMs).toBeGreaterThanOrEqual(40);
      expect(s.bufferMs).toBeLessThanOrEqual(80);
      expect(s.gain).toBeGreaterThan(0.9);
    }
  });
});
