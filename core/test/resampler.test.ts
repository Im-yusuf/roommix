import { describe, expect, it } from 'vitest';
import { createResampler } from '../src/pipeline/resampler.js';
import { db, noise, render, rmsOf, sine } from './helpers.js';

function resampleAll(
  inRate: number,
  outRate: number,
  input: Float32Array,
  chunkSizes?: number[],
): Float32Array {
  const resampler = createResampler(inRate, outRate);
  if (!chunkSizes) return resampler.process(input);
  const parts: Float32Array[] = [];
  let offset = 0;
  let i = 0;
  while (offset < input.length) {
    const size = Math.min(chunkSizes[i++ % chunkSizes.length], input.length - offset);
    parts.push(resampler.process(input.subarray(offset, offset + size)));
    offset += size;
  }
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

describe('resampler', () => {
  it('passes a 1 kHz tone from 48 kHz to 16 kHz within 0.5 dB', () => {
    const input = render(sine(1000, 0.5), 48000, 0, 48000);
    const output = resampleAll(48000, 16000, input);
    expect(output.length).toBeGreaterThan(15900);
    expect(Math.abs(db(rmsOf(output, 1600)) - db(rmsOf(input, 4800)))).toBeLessThan(0.5);
  });

  it('attenuates a 10 kHz tone by at least 50 dB when going to 16 kHz', () => {
    const input = render(sine(10000, 0.5), 48000, 0, 48000);
    const output = resampleAll(48000, 16000, input);
    expect(db(rmsOf(output, 1600)) - db(rmsOf(input))).toBeLessThan(-50);
  });

  it('is identical whether fed in one chunk or in arbitrary small chunks', () => {
    const input = render(noise(7, 0.3), 48000, 0, 48000);
    const whole = resampleAll(48000, 16000, input);
    const chunked = resampleAll(48000, 16000, input, [128, 1, 960, 333, 128, 4000, 7]);
    expect(chunked.length).toBe(whole.length);
    for (let i = 0; i < whole.length; i++) {
      if (chunked[i] !== whole[i])
        throw new Error(`differs at sample ${i}: ${chunked[i]} vs ${whole[i]}`);
    }
  });

  it('handles the non-integer 44.1 kHz ratio', () => {
    const input = render(sine(1000, 0.5), 44100, 0, 44100);
    const output = resampleAll(44100, 16000, input, [441, 882, 128]);
    // Everything is produced except the tail the filter's lookahead has not seen yet (~2 ms).
    expect(output.length).toBeLessThanOrEqual(16000);
    expect(output.length).toBeGreaterThan(16000 - 40);
    expect(Math.abs(db(rmsOf(output, 1600)) - db(rmsOf(input, 4410)))).toBeLessThan(0.5);
  });

  it('upsamples 8 kHz input', () => {
    const input = render(sine(1000, 0.5), 8000, 0, 8000);
    const output = resampleAll(8000, 16000, input, [80, 160]);
    expect(output.length).toBeLessThanOrEqual(16000);
    expect(output.length).toBeGreaterThan(16000 - 80);
    expect(Math.abs(db(rmsOf(output, 1600)) - db(rmsOf(input, 800)))).toBeLessThan(0.5);
  });

  it('is a pass-through when rates match', () => {
    const input = Float32Array.of(0.1, 0.2, 0.3);
    expect(createResampler(16000, 16000).process(input)).toBe(input);
  });
});
