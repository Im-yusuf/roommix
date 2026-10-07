import { describe, expect, it } from 'vitest';
import { FRAME_SAMPLES } from '../src/constants.js';
import { createFramer } from '../src/pipeline/framer.js';

describe('framer', () => {
  it('re-chunks arbitrary input sizes into exact frames and keeps the remainder', () => {
    const framer = createFramer();
    const frames: Float32Array[] = [];
    let n = 0;
    const next = (count: number) => {
      const chunk = new Float32Array(count);
      for (let i = 0; i < count; i++) chunk[i] = n++;
      return chunk;
    };
    const sizes = [128, 1, 500, 128, 7, 1000];
    for (const size of sizes) {
      framer.push(next(size), (frame) => {
        frames.push(frame);
      });
    }
    const total = sizes.reduce((a, b) => a + b, 0);
    expect(frames.length).toBe(Math.floor(total / FRAME_SAMPLES));
    frames.forEach((frame, i) => {
      expect(frame.length).toBe(FRAME_SAMPLES);
      expect(frame[0]).toBe(i * FRAME_SAMPLES); // nothing lost or reordered across chunk edges
      expect(frame[FRAME_SAMPLES - 1]).toBe((i + 1) * FRAME_SAMPLES - 1);
    });
    expect(new Set(frames).size).toBe(frames.length); // every frame is its own array
  });
});
