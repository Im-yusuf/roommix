export interface WavData {
  sampleRate: number;
  channels: number;
  /** Interleaved PCM16 samples. */
  samples: Int16Array;
}

/**
 * Reads a 16-bit PCM WAV. Other encodings are rejected with a clear message
 * instead of decoded badly; `ffmpeg -i in.wav -c:a pcm_s16le out.wav` converts them.
 */
export function decodeWav(bytes: Uint8Array): WavData {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (bytes.byteLength < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') {
    throw new Error('Not a RIFF/WAVE file');
  }

  let format: { sampleRate: number; channels: number } | undefined;
  let offset = 12;
  while (offset + 8 <= bytes.byteLength) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === 'fmt ') {
      const audioFormat = view.getUint16(body, true);
      const bitsPerSample = view.getUint16(body + 14, true);
      // 1 = PCM; 0xFFFE = WAVE_FORMAT_EXTENSIBLE, whose sub-format GUID starts with the PCM tag.
      const isPcm =
        audioFormat === 1 || (audioFormat === 0xfffe && view.getUint16(body + 24, true) === 1);
      if (!isPcm || bitsPerSample !== 16) {
        throw new Error(
          `Only 16-bit PCM WAV is supported (format ${audioFormat}, ${bitsPerSample} bits)`,
        );
      }
      format = {
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
      };
    } else if (id === 'data') {
      if (!format) throw new Error('WAV data chunk precedes fmt chunk');
      const length = Math.min(size, bytes.byteLength - body) & ~1;
      const samples = new Int16Array(bytes.slice(body, body + length).buffer);
      return { ...format, samples };
    }
    offset = body + size + (size % 2); // chunks are word-aligned
  }
  throw new Error('WAV file has no data chunk');
}

export function encodeWav(
  samples: Int16Array,
  sampleRate: number,
  channels = 1,
): Uint8Array<ArrayBuffer> {
  const dataBytes = samples.length * 2;
  const out = new Uint8Array(44 + dataBytes);
  const view = new DataView(out.buffer);
  const writeTag = (offset: number, text: string) => {
    for (let i = 0; i < 4; i++) out[offset + i] = text.charCodeAt(i);
  };
  writeTag(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeTag(8, 'WAVE');
  writeTag(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  writeTag(36, 'data');
  view.setUint32(40, dataBytes, true);
  for (let i = 0; i < samples.length; i++) view.setInt16(44 + i * 2, samples[i], true);
  return out;
}
