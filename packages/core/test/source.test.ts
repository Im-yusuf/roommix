import { describe, expect, it } from 'vitest';
import { FRAME_SAMPLES, STALL_AFTER_MS } from '../src/constants.js';
import { createSource } from '../src/source.js';

const frame = () => new Int16Array(FRAME_SAMPLES).fill(1000);

describe('source state machine', () => {
  it('goes joining -> live -> stalled -> live -> left', () => {
    const source = createSource('a', { sampleRate: 16000 }, { targetMs: 60, maxMs: 200 });
    expect(source.state).toBe('joining');
    source.push(frame());
    source.pull();
    expect(source.state).toBe('joining');
    source.push(frame());
    source.push(frame());
    expect(source.pull()).not.toBeNull();
    expect(source.state).toBe('live');

    source.pull();
    source.pull();
    for (let i = 0; i < STALL_AFTER_MS / 20; i++) source.pull();
    expect(source.state).toBe('stalled');

    source.push(frame());
    expect(source.pull()).toBeNull(); // after a gap the buffer refills to target first
    source.push(frame());
    source.push(frame());
    expect(source.pull()).not.toBeNull();
    expect(source.state).toBe('live');

    source.leave();
    source.pull();
    expect(source.state).toBe('left');
    expect(source.pull()).toBeNull();
  });

  it('mixes stereo input down to mono before the pipeline', () => {
    const source = createSource(
      'a',
      { sampleRate: 16000, channels: 2 },
      { targetMs: 20, maxMs: 200 },
    );
    const stereo = new Int16Array(FRAME_SAMPLES * 2);
    for (let i = 0; i < FRAME_SAMPLES; i++) {
      stereo[2 * i] = 2000;
      stereo[2 * i + 1] = 0;
    }
    source.push(stereo);
    const out = source.pull();
    expect(out).not.toBeNull();
    expect(source.stats().chunksIn).toBe(1);
    expect(() => source.push(new Int16Array(3))).toThrow(/whole number/);
  });
});
