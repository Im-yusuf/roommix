import { describe, expect, it } from 'vitest';
import {
  DRIFT_QUIET_WAIT_MS,
  DRIFT_WINDOW_MS,
  EDGE_FADE_SAMPLES,
  FRAME_MS,
  FRAME_SAMPLES,
} from '../src/constants.js';
import { createJitterBuffer } from '../src/pipeline/jitter-buffer.js';

const ones = () => new Float32Array(FRAME_SAMPLES).fill(1);
const quiet = () => new Float32Array(FRAME_SAMPLES).fill(0.001);
const isQuiet = (frame: Float32Array) => frame[FRAME_SAMPLES / 2] < 0.01;
const config = { targetMs: 60, maxMs: 200 };
const WINDOW = DRIFT_WINDOW_MS / FRAME_MS;

describe('jitter buffer', () => {
  it('plays nothing until the target depth is reached, then fades the first frame in', () => {
    const buffer = createJitterBuffer(config, isQuiet);
    buffer.push(ones());
    buffer.push(ones());
    expect(buffer.pull()).toBeNull();
    buffer.push(ones());
    const frame = buffer.pull();
    expect(frame).not.toBeNull();
    expect(frame?.[0]).toBe(0);
    expect(frame?.[EDGE_FADE_SAMPLES]).toBe(1);
    expect(frame?.[FRAME_SAMPLES - 1]).toBe(1);
  });

  it('fades out before a gap, refills to target after it, and fades back in', () => {
    const buffer = createJitterBuffer(config, isQuiet);
    for (let i = 0; i < 3; i++) buffer.push(ones());
    buffer.pull();
    buffer.pull();
    const last = buffer.pull();
    expect(last?.[FRAME_SAMPLES - 1]).toBe(0); // nothing followed it
    expect(buffer.pull()).toBeNull();
    expect(buffer.stats.underruns).toBe(1);

    buffer.push(ones());
    expect(buffer.pull()).toBeNull(); // one frame is not enough: refill to target first
    buffer.push(ones());
    buffer.push(ones());
    const resumed = buffer.pull();
    expect(resumed?.[0]).toBe(0);
    expect(resumed?.[FRAME_SAMPLES - 1]).toBe(1); // more frames are queued, no fade-out
  });

  it('drops back to target when a burst exceeds the maximum depth', () => {
    const buffer = createJitterBuffer(config, isQuiet);
    for (let i = 0; i < 25; i++) buffer.push(ones());
    expect(buffer.stats.depthFrames).toBeLessThanOrEqual(10);
    expect(buffer.stats.depthFrames).toBeGreaterThanOrEqual(3);
    expect(buffer.stats.drops).toBeGreaterThan(0);
    expect(buffer.stats.drops + buffer.stats.depthFrames).toBe(25);
  });

  it('drops a frame at a quiet moment when the depth stays above target for a whole window', () => {
    const buffer = createJitterBuffer(config, isQuiet);
    for (let i = 0; i < 4; i++) buffer.push(ones()); // one frame of surplus
    for (let i = 0; i < WINDOW; i++) {
      buffer.push(ones());
      expect(buffer.pull()).not.toBeNull();
    }
    expect(buffer.stats.drops).toBe(0); // loud throughout: the correction is still waiting
    // Quiet frames now arrive; once one is next in line the frame before it is faded out and it is dropped.
    let before: Float32Array | null = null;
    for (let i = 0; i < 8 && buffer.stats.drops === 0; i++) {
      buffer.push(quiet());
      before = buffer.pull();
    }
    expect(buffer.stats.drops).toBe(1);
    expect(before?.[FRAME_SAMPLES - 1]).toBe(0); // faded out across the seam
    expect(buffer.stats.depthFrames).toBe(3); // back at target
  });

  it('repeats a quiet frame when the depth stays below target for a whole window', () => {
    const buffer = createJitterBuffer(config, isQuiet);
    for (let i = 0; i < 3; i++) buffer.push(ones());
    buffer.pull();
    buffer.pull(); // one frame left: the source clock is running slow
    // Two windows, so at least one whole window sees the depth at 2, one short of target.
    for (let i = 0; i < 2 * WINDOW; i++) {
      buffer.push(ones());
      expect(buffer.pull()).not.toBeNull();
    }
    expect(buffer.stats.inserts).toBe(0);
    let copy: Float32Array | null = null;
    for (let i = 0; i < 8 && buffer.stats.inserts === 0; i++) {
      buffer.push(quiet());
      copy = buffer.pull(); // the quiet frame is played twice: a faded copy now, the real one next
    }
    expect(buffer.stats.inserts).toBe(1);
    expect(copy?.[FRAME_SAMPLES - 1]).toBe(0);
    buffer.push(quiet());
    expect(buffer.stats.depthFrames).toBe(3); // back at target
  });

  it('corrects drift anyway after waiting too long for a quiet frame', () => {
    const buffer = createJitterBuffer(config, isQuiet);
    for (let i = 0; i < 4; i++) buffer.push(ones());
    const wait = DRIFT_QUIET_WAIT_MS / FRAME_MS;
    for (let i = 0; i < WINDOW + wait; i++) {
      buffer.push(ones());
      buffer.pull();
    }
    expect(buffer.stats.drops).toBe(1);
    expect(buffer.stats.depthFrames).toBe(3);
  });
});
