import { describe, expect, it } from 'vitest';
import { decodeWav, encodeWav } from '../src/wav.js';

describe('wav', () => {
  it('round-trips PCM16', () => {
    const samples = Int16Array.of(0, 1, -1, 32767, -32768, 1234);
    const bytes = encodeWav(samples, 16000, 1);
    expect(bytes.length).toBe(44 + samples.length * 2);
    const decoded = decodeWav(bytes);
    expect(decoded.sampleRate).toBe(16000);
    expect(decoded.channels).toBe(1);
    expect(Array.from(decoded.samples)).toEqual(Array.from(samples));
  });

  it('skips unknown chunks before the data chunk', () => {
    const base = encodeWav(Int16Array.of(5, 6), 8000, 1);
    const list = new Uint8Array(8 + 4);
    list.set([0x4c, 0x49, 0x53, 0x54]); // LIST
    new DataView(list.buffer).setUint32(4, 4, true);
    const withList = new Uint8Array(base.length + list.length);
    withList.set(base.subarray(0, 36));
    withList.set(list, 36);
    withList.set(base.subarray(36), 36 + list.length);
    expect(Array.from(decodeWav(withList).samples)).toEqual([5, 6]);
  });

  it('rejects anything but 16-bit PCM with a helpful message', () => {
    const bytes = encodeWav(Int16Array.of(1), 16000, 1);
    new DataView(bytes.buffer).setUint16(34, 8, true); // bits per sample
    expect(() => decodeWav(bytes)).toThrow(/Only 16-bit PCM/);
    expect(() => decodeWav(new Uint8Array(10))).toThrow(/RIFF/);
  });
});
