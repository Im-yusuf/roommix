import {
  BLACKMAN_TRANSITION_BINS,
  RESAMPLER_CUTOFF_RATIO,
  RESAMPLER_PHASES,
  RESAMPLER_TRANSITION_RATIO,
} from '../constants.js';

export interface Resampler {
  /** Converts a chunk of any length. Output length varies by a sample as the position accumulates. */
  process(input: Float32Array): Float32Array;
}

/**
 * Band-limited rational resampler: a Blackman-windowed sinc low-pass, tabulated
 * at RESAMPLER_PHASES fractional offsets, applied by dot product around each
 * output position. The same filter anti-aliases when decimating and
 * anti-images when upsampling because the cutoff follows the lower rate.
 *
 * Position is tracked as an integer index plus a fraction with denominator
 * `outRate`, so there is no float drift however long the stream runs.
 */
export function createResampler(inRate: number, outRate: number): Resampler {
  if (inRate === outRate) return { process: (input) => input };

  const { taps, half } = filterTableFor(inRate, outRate);
  const tapCount = 2 * half + 1;

  // `pending` holds input samples not yet fully consumed; `pendingStart` is the
  // stream index of pending[0]. The stream is padded with `half` zeros so the
  // first output sample sees a full filter window.
  let pending = new Float32Array(half);
  let pendingStart = -half;
  let position = 0; // integer part of the next output time, in input samples
  let fraction = 0; // fractional part, as a numerator over outRate

  return {
    process(input) {
      // Leftover samples from the previous chunk, then the new ones: one contiguous window.
      const buffer = new Float32Array(pending.length + input.length);
      buffer.set(pending);
      buffer.set(input, pending.length);

      const available = pendingStart + buffer.length; // first stream index not yet received
      const out: number[] = [];

      // An output at `position` needs input up to position + half.
      while (position + half < available) {
        // Pick the precomputed filter for this output's fractional offset (0..1 → 0..PHASES).
        const phase = Math.round((fraction * RESAMPLER_PHASES) / outRate);
        const tapOffset = phase * tapCount;
        // Index into `buffer` of the first input sample under the filter window.
        const base = position - half - pendingStart;
        // The output sample is the dot product of the filter with the surrounding input.
        let acc = 0;
        for (let k = 0; k < tapCount; k++) acc += taps[tapOffset + k] * buffer[base + k];
        out.push(acc);

        // Advance the output time by inRate/outRate input samples, in exact
        // integer arithmetic: add inRate to the numerator, carry whole samples.
        fraction += inRate;
        const carry = Math.floor(fraction / outRate);
        position += carry;
        fraction -= carry * outRate;
      }

      // Keep only what future outputs can still reach.
      const keepFrom = Math.max(0, position - half - pendingStart);
      pending = buffer.slice(keepFrom);
      pendingStart += keepFrom;

      return Float32Array.from(out);
    },
  };
}

interface FilterTable {
  /** (RESAMPLER_PHASES + 1) phases of (2 * half + 1) taps each, every phase normalised to unit DC gain. */
  taps: Float32Array;
  half: number;
}

const tableCache = new Map<string, FilterTable>();

/** Tables are a few hundred KB and identical for every source with the same rates, so share them. */
function filterTableFor(inRate: number, outRate: number): FilterTable {
  const key = `${inRate}:${outRate}`;
  let table = tableCache.get(key);
  if (!table) {
    table = buildFilterTable(inRate, outRate);
    tableCache.set(key, table);
  }
  return table;
}

function buildFilterTable(inRate: number, outRate: number): FilterTable {
  // Cut below the Nyquist frequency of the lower rate: when going down this removes what
  // would alias; when going up it removes the images the new samples would create.
  const lowerRate = Math.min(inRate, outRate);
  const cutoff = (RESAMPLER_CUTOFF_RATIO * lowerRate) / inRate; // cycles per input sample
  const transition = (RESAMPLER_TRANSITION_RATIO * lowerRate) / inRate;
  // A sharper transition needs a longer filter; `half` taps on each side of the centre.
  const half = Math.ceil(BLACKMAN_TRANSITION_BINS / transition / 2);
  const tapCount = 2 * half + 1;
  const windowHalfWidth = half + 1; // window reaches zero just beyond the outermost tap

  // Phase p is the filter sampled at fractional offset p / PHASES. There is one
  // extra phase (offset exactly 1) so rounding never has to carry into the index.
  const taps = new Float32Array((RESAMPLER_PHASES + 1) * tapCount);
  for (let p = 0; p <= RESAMPLER_PHASES; p++) {
    const frac = p / RESAMPLER_PHASES;
    let sum = 0;
    for (let k = 0; k < tapCount; k++) {
      // Tap k multiplies input sample (position - half + k); its distance from the output time is:
      const distance = frac + half - k;
      // Ideal low-pass impulse response (sinc), tapered by the window so it can be finite.
      const value = sinc(2 * cutoff * distance) * 2 * cutoff * blackman(distance / windowHalfWidth);
      taps[p * tapCount + k] = value;
      sum += value;
    }
    // Taps summing to exactly one means a constant input comes out unchanged at every phase.
    for (let k = 0; k < tapCount; k++) taps[p * tapCount + k] /= sum;
  }
  return { taps, half };
}

/** Normalised sinc, sin(πx)/(πx): the impulse response of an ideal low-pass filter. */
function sinc(x: number): number {
  if (x === 0) return 1;
  const px = Math.PI * x;
  return Math.sin(px) / px;
}

/** Blackman window for |x| <= 1, zero outside. */
function blackman(x: number): number {
  if (x <= -1 || x >= 1) return 0;
  return 0.42 + 0.5 * Math.cos(Math.PI * x) + 0.08 * Math.cos(2 * Math.PI * x);
}
