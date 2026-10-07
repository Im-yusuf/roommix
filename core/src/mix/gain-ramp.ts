/**
 * Adds `frame * gain` into `out`, with the gain moving linearly from `from` to
 * `to` across the frame. A per-sample ramp is what keeps gain changes free of
 * steps you could hear as clicks or zipper noise.
 */
/** Scales `frame` in place with the gain moving linearly from `from` to `to` across it. */
export function applyGainRamp(frame: Float32Array, from: number, to: number): void {
  const step = (to - from) / frame.length;
  let gain = from;
  for (let i = 0; i < frame.length; i++) {
    frame[i] *= gain;
    gain += step;
  }
}

export function addWithGainRamp(
  out: Float32Array,
  frame: Float32Array,
  from: number,
  to: number,
): void {
  const step = (to - from) / frame.length;
  let gain = from;
  for (let i = 0; i < frame.length; i++) {
    out[i] += frame[i] * gain;
    gain += step;
  }
}
