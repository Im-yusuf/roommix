import { describe, expect, it } from 'vitest';
import { createMixer, MixerError, type StrategyName } from '../src/index.js';

describe('mixer api', () => {
  it('idles with no sources and emits one frame per 20 ms once a source exists', () => {
    const mixer = createMixer();
    const sequences: number[] = [];
    mixer.on('frame', (f) => sequences.push(f.sequence));
    mixer.tick(0);
    mixer.tick(1000);
    expect(sequences).toEqual([]);

    mixer.addSource('a', { sampleRate: 16000 });
    mixer.tick(1000); // anchors the clock
    mixer.tick(1007); // not a full frame yet
    mixer.tick(1041); // 2 frames owed
    mixer.tick(1060); // 1 more
    expect(sequences).toEqual([1, 2, 3]);
    expect(sequences.length).toBe(3);
  });

  it('skips ahead instead of bursting after a long host stall', () => {
    const mixer = createMixer();
    let frames = 0;
    mixer.on('frame', () => frames++);
    mixer.addSource('a', { sampleRate: 16000 });
    mixer.tick(0);
    mixer.tick(60_000);
    expect(frames).toBe(50); // MAX_CATCHUP_MS worth, not 3000
    mixer.tick(60_020);
    expect(frames).toBe(51);
  });

  it('validates sources and chunks', () => {
    const mixer = createMixer();
    mixer.addSource('a', { sampleRate: 48000 });
    expect(() => mixer.addSource('a', { sampleRate: 48000 })).toThrow(/already exists/);
    expect(() => mixer.addSource('b', { sampleRate: Number.NaN })).toThrow(/sampleRate/);
    expect(() => mixer.addSource('b', { sampleRate: 44100.5 })).toThrow(/sampleRate/);
    expect(() => mixer.addSource('b', { sampleRate: 1000 })).toThrow(/sampleRate/);
    expect(() => mixer.addSource('b', { sampleRate: 16000, channels: 0 })).toThrow(/channels/);
    expect(() => mixer.push('nope', new Int16Array(10))).toThrow(/No source/);
    expect(() => mixer.push('a', new Uint8Array(3))).toThrow(/odd byte length/);
    expect(() => mixer.push('a', new Int16Array(48001))).toThrow(/longer than/);
    expect(() => mixer.removeSource('nope')).toThrowError(MixerError);
    expect(() => mixer.setStrategy('nope' as StrategyName)).toThrow(/Unknown strategy/);
    mixer.push('a', new Int16Array(128)); // small chunks are fine
    mixer.push('a', new Int16Array(960).buffer);
  });
});
