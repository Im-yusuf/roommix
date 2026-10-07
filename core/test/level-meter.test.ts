import { describe, expect, it } from 'vitest';
import { FLOOR_MAX_DBFS, FLOOR_MIN_DBFS } from '../src/constants.js';
import { createLevelMeter, dbToLinear } from '../src/pipeline/level-meter.js';
import { render, sine } from './helpers.js';

const loud = render(sine(1000, 0.5), 16000, 0, 320); // RMS ~0.354
const silence = new Float32Array(320);

describe('level meter', () => {
  it('attacks fast and releases slowly', () => {
    const meter = createLevelMeter();
    meter.update(loud);
    const afterTwo = meter.update(loud).level;
    expect(afterTwo).toBeGreaterThan(0.354 * 0.95);

    const peak = meter.update(loud).level;
    const afterOneSilent = meter.update(silence).level;
    expect(afterOneSilent).toBeGreaterThan(peak * 0.9);
  });

  it('tracks the floor as a slow-rising minimum', () => {
    const meter = createLevelMeter();
    expect(meter.reading.floor).toBeCloseTo(dbToLinear(FLOOR_MIN_DBFS), 8);
    let reading = meter.reading;
    for (let i = 0; i < 250; i++) reading = meter.update(loud); // 5 s of steady tone
    expect(reading.floor).toBeLessThan(dbToLinear(FLOOR_MIN_DBFS + 16)); // rose at most 3 dB/s
    reading = meter.update(silence);
    expect(reading.floor).toBeLessThan(reading.level + 1e-9); // drops to the new minimum at once
  });

  it('caps the floor so a loud steady signal cannot mute itself', () => {
    const meter = createLevelMeter();
    let reading = meter.reading;
    for (let i = 0; i < 5000; i++) reading = meter.update(loud); // 100 s
    expect(reading.floor).toBeCloseTo(dbToLinear(FLOOR_MAX_DBFS), 6);
    expect(reading.level - reading.floor).toBeGreaterThan(0.3);
  });
});
