import { describe, expect, it } from 'vitest';
import { MixerError } from '../src/errors.js';
import { floatToPcm16, pcm16ToFloat, toInt16, toMono } from '../src/pipeline/pcm.js';

describe('pcm', () => {
  it('rejects an odd byte length', () => {
    expect(() => toInt16(new Uint8Array(3))).toThrowError(MixerError);
    expect(() => toInt16(new Uint8Array(3))).toThrow(/odd byte length/);
  });

  it('reads unaligned byte views correctly by copying', () => {
    const backing = new Uint8Array(5);
    const view = new DataView(backing.buffer);
    view.setInt16(1, -1234, true);
    view.setInt16(3, 4567, true);
    const pcm = toInt16(backing.subarray(1, 5));
    expect(Array.from(pcm)).toEqual([-1234, 4567]);
  });

  it('accepts ArrayBuffer and Int16Array as-is', () => {
    const int16 = Int16Array.of(1, -2, 3);
    expect(toInt16(int16)).toBe(int16);
    expect(Array.from(toInt16(int16.buffer))).toEqual([1, -2, 3]);
  });

  it('round-trips float and PCM16 with clamping', () => {
    const floats = Float32Array.of(0, 0.5, -0.5, 1.5, -1.5);
    const pcm = new Int16Array(floats.length);
    floatToPcm16(floats, pcm);
    expect(Array.from(pcm)).toEqual([0, 16384, -16384, 32767, -32768]);
    const back = pcm16ToFloat(pcm);
    expect(back[1]).toBeCloseTo(0.5, 6);
    expect(back[3]).toBeCloseTo(32767 / 32768, 6);
  });

  it('averages interleaved channels to mono', () => {
    expect(Array.from(toMono(Float32Array.of(1, 0, 0.5, 0.5), 2))).toEqual([0.5, 0.5]);
    const mono = Float32Array.of(1, 2);
    expect(toMono(mono, 1)).toBe(mono);
  });
});
