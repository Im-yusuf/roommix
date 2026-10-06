export const TWO_PI = 2 * Math.PI;

/** Signal as a function of time in seconds, so delays are just `t - delay`. */
export type Signal = (t: number) => number;

export function sine(freq: number, amplitude = 0.5, delaySeconds = 0): Signal {
  return (t) => amplitude * Math.sin(TWO_PI * freq * (t - delaySeconds));
}

/** Deterministic uniform random numbers in [0, 1) (mulberry32) so test runs are reproducible. */
export function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}

/** White noise with the given RMS. */
export function noise(seed: number, amplitude = 0.1): Signal {
  const random = createRandom(seed);
  // Uniform on [-1, 1] has RMS 1/sqrt(3), so this makes `amplitude` the RMS.
  return () => amplitude * (random() * 2 - 1) * Math.sqrt(3);
}

/** A tone that pauses regularly, like speech with gaps: on for `onSeconds`, off for `offSeconds`. */
export function gated(signal: Signal, onSeconds: number, offSeconds: number): Signal {
  const period = onSeconds + offSeconds;
  return (t) => (t % period < onSeconds ? signal(t) : 0);
}

export function render(
  signal: Signal,
  sampleRate: number,
  fromSample: number,
  count: number,
): Float32Array {
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) out[i] = signal((fromSample + i) / sampleRate);
  return out;
}

export function toPcm16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    out[i] = Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32768)));
  }
  return out;
}

export function rmsOf(samples: ArrayLike<number>, from = 0, to = samples.length): number {
  let sum = 0;
  for (let i = from; i < to; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / Math.max(1, to - from));
}

export function db(linear: number): number {
  return 20 * Math.log10(Math.max(linear, 1e-12));
}

/** Level of one frequency in a signal (Goertzel), as RMS of that component. */
export function toneRms(
  samples: ArrayLike<number>,
  freq: number,
  sampleRate: number,
  from = 0,
  to = samples.length,
): number {
  const n = to - from;
  const w = (TWO_PI * freq) / sampleRate;
  const coeff = 2 * Math.cos(w);
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  for (let i = from; i < to; i++) {
    s0 = samples[i] + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  const power = s1 * s1 + s2 * s2 - coeff * s1 * s2;
  return (Math.sqrt(Math.max(0, power)) / n) * Math.SQRT2;
}

/** Largest absolute sample-to-sample jump. A click shows up as a jump far above the signal's own slope. */
export function maxStep(samples: ArrayLike<number>, from = 0, to = samples.length): number {
  let max = 0;
  for (let i = Math.max(1, from); i < to; i++) {
    const step = Math.abs(samples[i] - samples[i - 1]);
    if (step > max) max = step;
  }
  return max;
}
