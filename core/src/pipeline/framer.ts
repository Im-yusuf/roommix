import { FRAME_SAMPLES } from '../constants.js';

/**
 * Re-chunks a sample stream of arbitrary chunk sizes into fixed frames.
 * Each completed frame is a fresh array, so the consumer may keep it.
 */
export function createFramer(frameSamples = FRAME_SAMPLES) {
  let pending = new Float32Array(frameSamples);
  let filled = 0;

  return {
    push(samples: Float32Array, onFrame: (frame: Float32Array) => void): void {
      let offset = 0;
      while (offset < samples.length) {
        const take = Math.min(frameSamples - filled, samples.length - offset);
        pending.set(samples.subarray(offset, offset + take), filled);
        filled += take;
        offset += take;
        if (filled === frameSamples) {
          onFrame(pending);
          pending = new Float32Array(frameSamples);
          filled = 0;
        }
      }
    },
  };
}
