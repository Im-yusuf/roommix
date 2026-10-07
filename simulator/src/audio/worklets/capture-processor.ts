const CHUNK_SECONDS = 0.02;

/**
 * Runs on the audio thread. Collects the 128-sample render quanta into 20 ms
 * chunks of PCM16 at the context's own rate and posts each one with its RMS.
 * The output is silence: this node only taps the signal.
 */
class CaptureProcessor extends AudioWorkletProcessor {
  private chunk = new Int16Array(Math.round(sampleRate * CHUNK_SECONDS));
  private filled = 0;
  private sumSquares = 0;

  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0]?.[0];
    if (!input) return true;
    for (let i = 0; i < input.length; i++) {
      const v = Math.max(-1, Math.min(1, input[i]));
      this.chunk[this.filled++] = Math.round(v * 32767);
      this.sumSquares += v * v;
      if (this.filled === this.chunk.length) this.flush();
    }
    return true;
  }

  private flush(): void {
    const rms = Math.sqrt(this.sumSquares / this.chunk.length);
    this.port.postMessage({ pcm: this.chunk.buffer, rms }, [this.chunk.buffer]);
    this.chunk = new Int16Array(Math.round(sampleRate * CHUNK_SECONDS));
    this.filled = 0;
    this.sumSquares = 0;
  }
}

registerProcessor('capture-processor', CaptureProcessor);
