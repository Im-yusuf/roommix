import { EDGE_FADE_SAMPLES } from '../constants.js';

/** Linear ramp from silence over the first samples of the frame. */
export function fadeIn(frame: Float32Array, samples = EDGE_FADE_SAMPLES): void {
  const n = Math.min(samples, frame.length);
  for (let i = 0; i < n; i++) frame[i] *= i / n;
}

/** Linear ramp to silence over the last samples of the frame. */
export function fadeOut(frame: Float32Array, samples = EDGE_FADE_SAMPLES): void {
  const n = Math.min(samples, frame.length);
  const start = frame.length - n;
  for (let i = 0; i < n; i++) frame[start + i] *= 1 - (i + 1) / n;
}
