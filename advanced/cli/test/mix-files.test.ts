import { decodeWav, encodeWav, type WavData } from '@roommix/core';
import { describe, expect, it } from 'vitest';
import { mixFiles } from '../src/mix-files.js';

function toneWav(
  freq: number,
  sampleRate: number,
  seconds: number,
  channels = 1,
  amplitude = 0.3,
): WavData {
  const frames = Math.round(sampleRate * seconds);
  const samples = new Int16Array(frames * channels);
  for (let i = 0; i < frames; i++) {
    const v = Math.round(amplitude * 32768 * Math.sin((2 * Math.PI * freq * i) / sampleRate));
    for (let c = 0; c < channels; c++) samples[i * channels + c] = v;
  }
  // Round-trip through the codec so the test covers the same path as the CLI.
  return decodeWav(encodeWav(samples, sampleRate, channels));
}

function toneLevel(pcm: Int16Array, freq: number, from: number, to: number): number {
  const w = (2 * Math.PI * freq) / 16000;
  let re = 0;
  let im = 0;
  for (let i = from; i < to; i++) {
    re += pcm[i] * Math.cos(w * i);
    im -= pcm[i] * Math.sin(w * i);
  }
  return (Math.hypot(re, im) * 2) / (to - from) / 32768;
}

describe('mixFiles', () => {
  it('mixes files of different rates and channel counts into 16 kHz mono', () => {
    const a = toneWav(440, 48000, 2.0);
    const b = toneWav(1500, 44100, 1.0, 2);
    const { pcm, stats } = mixFiles([a, b], 'gain-sharing', { leveler: false });

    const seconds = pcm.length / 16000;
    expect(seconds).toBeGreaterThan(2.0);
    expect(seconds).toBeLessThan(2.3);

    // Both tones are present while both files play...
    expect(toneLevel(pcm, 440, 8000, 16000)).toBeGreaterThan(0.08);
    expect(toneLevel(pcm, 1500, 8000, 16000)).toBeGreaterThan(0.08);
    // ...and only the long one afterwards, at unity.
    expect(toneLevel(pcm, 440, 24000, 30000)).toBeGreaterThan(0.25);
    expect(toneLevel(pcm, 1500, 24000, 30000)).toBeLessThan(0.01);

    expect(stats.map((s) => s.id)).toEqual(['file1', 'file2']);
    expect(stats.every((s) => s.drops === 0)).toBe(true);
  });

  it('supports the plain-sum baseline', () => {
    const a = toneWav(440, 16000, 0.5);
    const { pcm } = mixFiles([a, a], 'plain-sum', { leveler: false });
    expect(toneLevel(pcm, 440, 2000, 7000)).toBeGreaterThan(0.5);
  });

  it('levels the output by default, as the live service does', () => {
    const a = toneWav(440, 16000, 2.0); // -13.5 dBFS, louder than the leveler's target
    const raw = toneLevel(mixFiles([a], 'gain-sharing', { leveler: false }).pcm, 440, 16000, 30000);
    const leveled = toneLevel(mixFiles([a]).pcm, 440, 16000, 30000);
    expect(raw).toBeGreaterThan(0.25);
    // -20 dBFS RMS is an amplitude of about 0.14.
    expect(leveled).toBeGreaterThan(0.1);
    expect(leveled).toBeLessThan(0.2);
  });
});
