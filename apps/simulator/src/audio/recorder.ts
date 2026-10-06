import { encodeWav, FRAME_MS, FRAME_SAMPLES, SAMPLE_RATE } from '@roommix/core';

const MAX_FRAMES = (10 * 60 * 1000) / FRAME_MS; // ten minutes keeps memory bounded

/** Collects mixed frames in memory and turns them into a WAV blob for download. */
export function createRecorder() {
  let frames: Int16Array[] = [];
  return {
    push(frame: Int16Array): void {
      if (frames.length < MAX_FRAMES) frames.push(frame.slice(0, FRAME_SAMPLES));
    },
    get durationMs(): number {
      return frames.length * FRAME_MS;
    },
    clear(): void {
      frames = [];
    },
    toBlob(): Blob {
      const all = new Int16Array(frames.length * FRAME_SAMPLES);
      frames.forEach((frame, i) => all.set(frame, i * FRAME_SAMPLES));
      return new Blob([encodeWav(all, SAMPLE_RATE, 1)], { type: 'audio/wav' });
    },
  };
}
