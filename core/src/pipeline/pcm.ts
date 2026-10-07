import { MixerError } from '../errors.js';
import type { PcmChunk } from '../types.js';

const INT16_SCALE = 32768;

/**
 * Normalises the accepted input shapes to an Int16Array view without copying
 * when the bytes are already aligned. Node Buffers from a socket are often
 * unaligned slices of a larger pool, so those are copied.
 */
export function toInt16(chunk: PcmChunk): Int16Array {
  if (chunk instanceof Int16Array) return chunk;
  const bytes = chunk instanceof ArrayBuffer ? new Uint8Array(chunk) : chunk;
  if (bytes.byteLength % 2 !== 0) {
    throw new MixerError('invalid_chunk', `PCM16 chunk has odd byte length ${bytes.byteLength}`);
  }
  if (bytes.byteOffset % 2 === 0) {
    return new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
  }
  return new Int16Array(bytes.slice().buffer);
}

export function pcm16ToFloat(src: Int16Array): Float32Array {
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = src[i] / INT16_SCALE;
  return out;
}

/** Clamps to the int16 range; the limiter normally keeps values inside it already. */
export function floatToPcm16(src: Float32Array, dst: Int16Array): void {
  for (let i = 0; i < src.length; i++) {
    const v = Math.round(src[i] * INT16_SCALE);
    dst[i] = v > 32767 ? 32767 : v < -32768 ? -32768 : v;
  }
}

/** Averages interleaved channels into one. Returns the input untouched for mono. */
export function toMono(interleaved: Float32Array, channels: number): Float32Array {
  if (channels === 1) return interleaved;
  const frames = Math.floor(interleaved.length / channels);
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) sum += interleaved[i * channels + c];
    out[i] = sum / channels;
  }
  return out;
}
